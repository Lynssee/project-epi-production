// src/lib/utils/tutupBulan.ts
// MODUL MURNI (tanpa I/O). Logika "Tutup Bulan" Laporan Bulanan Terpadu di dashboard lapangan: periode, checklist kelengkapan laporan harian,
// kandidat foto, dan validasi isian narasi Project Leader. Data narasi disimpan di koleksi `laporan_bulanan_narasi` (skema: erp-epi/scripts/laporan-bulanan-narasi-schema.mjs)
// dan dibaca erp-epi untuk Laporan Bulanan Terpadu. TIDAK menahan/mengunci apa pun: hanya memberi tahu apa yang masih kurang.

export const EXCLUDED_REPORT_STATUS = ['draft', 'rejected', 'ditolak'];
export const MAX_PHOTOS = 24;
export const MAX_PHOTO_CANDIDATES = 120;
export const MAX_TEXT = 4000;

const isObj = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (v == null ? '' : String(v).trim());

export const isValidPeriod = (p: unknown): p is string => typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
export const currentPeriod = (now: Date = new Date()): string => now.toISOString().slice(0, 7);

export function periodRange(period: string): { start: string; endExclusive: string; days: number } | null {
	const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period || '');
	if (!m) return null;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const pad = (n: number) => String(n).padStart(2, '0');
	const ny = mo === 12 ? y + 1 : y;
	const nm = mo === 12 ? 1 : mo + 1;
	return { start: `${y}-${pad(mo)}-01`, endExclusive: `${ny}-${pad(nm)}-01`, days: new Date(Date.UTC(y, mo, 0)).getUTCDate() };
}

function parseLoose(v: unknown): any {
	if (typeof v !== 'string') return v ?? null;
	const s = v.trim();
	if (!s) return null;
	if (s.startsWith('{') || s.startsWith('[')) { try { return JSON.parse(s); } catch { return s; } }
	return s;
}
const asArray = (v: unknown): any[] => { const p = parseLoose(v); return Array.isArray(p) ? p : p && isObj(p) ? [p] : []; };

export interface PhotoCandidate { id: string; category: string; label: string; date: string }

/** Cermin collectPhotos erp-epi (laporanBulananAggregate.js): kandidat foto unik dari satu laporan harian. */
export function collectPhotos(report: any): PhotoCandidate[] {
	const out: PhotoCandidate[] = [];
	const seen = new Set<string>();
	const date = str(report?.date).slice(0, 10);
	const add = (src: unknown, category: string, defLabel: string) => {
		const list = typeof src === 'string' && !/^[[{]/.test(src.trim()) && src.includes(',') ? src.split(',') : src;
		for (const f of asArray(list)) {
			let id: any = null;
			let label = defLabel;
			if (typeof f === 'string') id = f.trim();
			else if (isObj(f)) {
				id = f.id || f.directus_files_id || f.file_id || f.url;
				if (isObj(id)) id = id.id;
				label = f.label || f.caption || f.description || f.name || defLabel;
			}
			if (typeof id === 'string' && id.length > 5 && !seen.has(id)) { seen.add(id); out.push({ id, category, label: str(label) || defLabel, date }); }
		}
	};
	const hse = parseLoose(report?.hse_daily);
	add(report?.progress_photos, 'progress', 'Dokumentasi progres fisik');
	add(report?.area_kerja_photos, 'area', 'Kondisi area kerja');
	add(report?.toolbox_photos, 'safety', 'Toolbox meeting & K3');
	if (isObj(hse)) { add(hse.tbm_photos, 'safety', 'Toolbox meeting & K3'); add(hse.photos, 'safety', 'Foto K3 & APD'); }
	add(report?.issue_photos, 'issue', 'Temuan kendala');
	for (const pi of asArray(report?.progress)) {
		if (!isObj(pi)) continue;
		const name = str(pi.activity) || 'Progres subtask';
		add(pi.foto_after, 'progress', `${name} (After)`);
		add(pi.foto_bukti, 'progress', name);
	}
	return out;
}

export const photoCandidatesOf = (reports: any[]): PhotoCandidate[] =>
	(Array.isArray(reports) ? reports : [])
		.filter((r) => !EXCLUDED_REPORT_STATUS.includes(str(r?.status).toLowerCase()))
		.sort((a, b) => str(a?.date).localeCompare(str(b?.date)))
		.flatMap(collectPhotos)
		.slice(0, MAX_PHOTO_CANDIDATES);

export interface Checklist {
	hariKalender: number;
	hariTarget: number; // bulan berjalan: sampai kemarin; bulan lalu: seluruh bulan
	hariBerlapor: number;
	hariKosong: string[]; // tanggal (YYYY-MM-DD) tanpa laporan dalam jangkauan target
	laporanDihitung: number;
	laporanDraf: number;
	laporanDitolak: number;
	bulanBerjalan: boolean;
	kepatuhanPct: number | null;
}

/**
 * Checklist kelengkapan laporan harian. `today` (YYYY-MM-DD) diinjeksi agar murni/teruji.
 * Bulan berjalan: hari target = sampai KEMARIN (laporan hari ini belum wajib). Bulan depan (masa depan): target 0.
 */
export function buildChecklist(reports: any[], period: string, today: string = new Date().toISOString().slice(0, 10)): Checklist | null {
	const range = periodRange(period);
	if (!range) return null;
	const list = Array.isArray(reports) ? reports : [];
	const counted = list.filter((r) => r && !EXCLUDED_REPORT_STATUS.includes(str(r.status).toLowerCase()));
	const daysWith = new Set(counted.map((r) => str(r.date).slice(0, 10)).filter(Boolean));
	const bulanBerjalan = today >= range.start && today < range.endExclusive;
	const lastTarget = bulanBerjalan ? Math.max(0, Number(today.slice(8, 10)) - 1) : today >= range.endExclusive ? range.days : 0;
	const hariKosong: string[] = [];
	for (let d = 1; d <= lastTarget; d++) {
		const iso = `${period}-${String(d).padStart(2, '0')}`;
		if (!daysWith.has(iso)) hariKosong.push(iso);
	}
	return {
		hariKalender: range.days,
		hariTarget: lastTarget,
		hariBerlapor: daysWith.size,
		hariKosong,
		laporanDihitung: counted.length,
		laporanDraf: list.filter((r) => str(r?.status).toLowerCase() === 'draft').length,
		laporanDitolak: list.filter((r) => ['rejected', 'ditolak'].includes(str(r?.status).toLowerCase())).length,
		bulanBerjalan,
		kepatuhanPct: lastTarget > 0 ? Math.round(((lastTarget - hariKosong.length) / lastTarget) * 100) : null
	};
}

/** Hal-hal yang masih kurang sebelum menutup bulan. Hanya PERINGATAN — penutupan tidak pernah diblokir. */
export function closeWarnings(checklist: Checklist | null, narasi: { kendala_utama?: string; rencana_bulan_depan?: string } | null): string[] {
	const w: string[] = [];
	if (!checklist) return ['Periode tidak valid.'];
	if (checklist.bulanBerjalan) w.push('Bulan masih berjalan — laporan hari-hari berikutnya belum masuk.');
	if (checklist.hariKosong.length) w.push(`${checklist.hariKosong.length} hari belum ada laporan harian.`);
	if (checklist.laporanDraf) w.push(`${checklist.laporanDraf} laporan masih berstatus draf (tidak dihitung).`);
	if (checklist.laporanDitolak) w.push(`${checklist.laporanDitolak} laporan ditolak (tidak dihitung).`);
	if (!str(narasi?.kendala_utama)) w.push('Kendala utama belum diisi.');
	if (!str(narasi?.rencana_bulan_depan)) w.push('Rencana bulan depan belum diisi.');
	return w;
}

export type NarasiAction = 'save' | 'close' | 'reopen';
export interface NarasiInput {
	projectId: number;
	period: string;
	action: NarasiAction;
	kendala_utama: string;
	rencana_bulan_depan: string;
	catatan_manajemen: string;
	photo_ids: string[];
}

/** Validasi isian POST. Mengembalikan galat per-bidang (bukan melempar) agar endpoint memetakan ke 400 dengan pesan jelas. */
export function validateNarasiInput(body: unknown): { ok: true; value: NarasiInput } | { ok: false; error: string } {
	const b: any = isObj(body) ? body : {};
	const projectId = Number(b.projectId);
	if (!Number.isInteger(projectId) || projectId <= 0) return { ok: false, error: 'projectId wajib berupa angka.' };
	if (!isValidPeriod(b.period)) return { ok: false, error: 'period harus format YYYY-MM.' };
	const action = (b.action ?? 'save') as NarasiAction;
	if (!['save', 'close', 'reopen'].includes(action)) return { ok: false, error: 'action harus save, close, atau reopen.' };
	const text = (k: string): string | { err: string } => {
		const v = b[k];
		if (v == null) return '';
		if (typeof v !== 'string') return { err: `${k} harus berupa teks.` };
		if (v.length > MAX_TEXT) return { err: `${k} terlalu panjang (maks ${MAX_TEXT} karakter).` };
		return v.trim();
	};
	const kendala = text('kendala_utama');
	const rencana = text('rencana_bulan_depan');
	const catatan = text('catatan_manajemen');
	for (const t of [kendala, rencana, catatan]) if (typeof t !== 'string') return { ok: false, error: t.err };
	let photo_ids: string[] = [];
	if (b.photo_ids != null) {
		if (!Array.isArray(b.photo_ids)) return { ok: false, error: 'photo_ids harus berupa daftar.' };
		photo_ids = [...new Set(b.photo_ids.filter((x: unknown): x is string => typeof x === 'string' && /^[\w-]{6,80}$/.test(x)))].slice(0, MAX_PHOTOS) as string[];
	}
	return { ok: true, value: { projectId, period: b.period, action, kendala_utama: kendala as string, rencana_bulan_depan: rencana as string, catatan_manajemen: catatan as string, photo_ids } };
}
