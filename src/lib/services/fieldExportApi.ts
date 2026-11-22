// src/lib/services/fieldExportApi.ts
// Fase "Export Universal — Dashboard Lapangan" (§5.4 rencana).
//
// Flattener TIPIS untuk export lapangan. Setiap fungsi hanya memanggil SERVICE
// LAPANGAN yang sudah ada, lalu meratakan jadi baris datar.
//
// ATURAN KERAS (§5.4 P2 — data sensitif MUTLAK DILARANG keluar ke lapangan):
//   • TIDAK ADA kolom harga / nilai / margin / HPP / kontrak di sini.
//     Contoh: getPackingRequests() membawa `unit_price` — flattener di bawah
//     SENGAJA membuangnya, hanya kuantitas & satuan yang keluar.
//   • Ini daftar putih terpisah, BUKAN registry admin yang difilter. Section
//     sensitif tidak pernah punya entri di file ini.
//
// Kontrak: (projectId, opts?) => Promise<Array<Record<string, unknown>>>
//   opts.dateRange = { from?: 'YYYY-MM-DD'; to?: 'YYYY-MM-DD' }

import { getProjectInventory, getProjectInventoryLogs } from '$lib/services/projectStockInventoryApi';
import { fetchWbsTree } from '$lib/services/wbsApi';
import { getReports } from '$lib/services/reports';
import { getAbsensiForProjectsInRange } from '$lib/services/manpowerAbsensi';
import { getPackingRequests } from '$lib/services/packingList';
import { fetchProjectPunchList } from '$lib/services/projectPunchListApi';

export interface FieldDateRange {
	from?: string;
	to?: string;
}
export interface FieldExportOpts {
	dateRange?: FieldDateRange;
}

/* ------------------------------------------------------------------ helpers */

export function pick(obj: unknown, path: string): unknown {
	if (obj == null) return '';
	const v = String(path)
		.split('.')
		.reduce<unknown>((acc, k) => (acc == null ? undefined : (acc as Record<string, unknown>)[k]), obj);
	return v == null ? '' : v;
}

export interface FieldColumn {
	header: string;
	key: string;
	type?: 'number' | 'date' | 'text';
}

/** Ratakan array baris mentah → array baris datar sesuai `columns` (null-safe). */
export function flattenForField(
	rows: unknown,
	columns: FieldColumn[]
): Array<Record<string, unknown>> {
	const list = Array.isArray(rows) ? rows : [];
	return list.map((r) => {
		const out: Record<string, unknown> = {};
		for (const c of columns) {
			let v = pick(r, c.key);
			if (c.type === 'number') {
				const n = typeof v === 'number' ? v : parseFloat(String(v));
				v = Number.isFinite(n) ? n : 0;
			} else if (c.type === 'date' && v) {
				v = String(v).slice(0, 10);
			}
			out[c.key] = v;
		}
		return out;
	});
}

function inRange(dateStr: unknown, range?: FieldDateRange): boolean {
	if (!range || (!range.from && !range.to)) return true;
	const d = String(dateStr ?? '').slice(0, 10);
	if (!d) return true;
	if (range.from && d < range.from) return false;
	if (range.to && d > range.to) return false;
	return true;
}

/* --------------------------------------------------------------- flatteners */

export async function flattenInventoryForField(projectId: number): Promise<Array<Record<string, unknown>>> {
	const rows = await getProjectInventory(projectId);
	return Array.isArray(rows) ? (rows as unknown as Array<Record<string, unknown>>) : [];
}

export async function flattenStockLogForField(
	projectId: number,
	opts: FieldExportOpts = {}
): Promise<Array<Record<string, unknown>>> {
	const rows = await getProjectInventoryLogs(projectId);
	const list = Array.isArray(rows) ? (rows as unknown as Array<Record<string, unknown>>) : [];
	return list.filter((r) => inRange(r.date, opts.dateRange));
}

export async function flattenTimelineForField(projectId: number): Promise<Array<Record<string, unknown>>> {
	const { flat } = await fetchWbsTree(projectId);
	return Array.isArray(flat) ? (flat as unknown as Array<Record<string, unknown>>) : [];
}

export async function flattenLaporanHarianForField(
	projectId: number,
	opts: FieldExportOpts = {}
): Promise<Array<Record<string, unknown>>> {
	const rows = await getReports(projectId, { limit: 500 });
	const list = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
	return list.filter((r) => inRange((r.tanggal as string) || (r.date as string), opts.dateRange));
}

export async function flattenAbsensiForField(
	projectId: number,
	opts: FieldExportOpts = {}
): Promise<Array<Record<string, unknown>>> {
	const range = opts.dateRange || {};
	// getAbsensiForProjectsInRange butuh rentang — default 90 hari terakhir bila kosong.
	const to = range.to || new Date().toISOString().slice(0, 10);
	const from =
		range.from ||
		new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
	const rows = await getAbsensiForProjectsInRange([projectId], from, to);
	return Array.isArray(rows) ? (rows as unknown as Array<Record<string, unknown>>) : [];
}

export async function flattenPackingListForField(projectId: number): Promise<Array<Record<string, unknown>>> {
	const rows = await getPackingRequests(projectId, { limit: 500 });
	const list = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
	// Buang unit_price secara eksplisit — tidak boleh keluar ke lapangan.
	return list.map((r) => {
		const clone: Record<string, unknown> = { ...r };
		delete clone.unit_price;
		return clone;
	});
}

export async function flattenPunchListForField(projectId: number): Promise<Array<Record<string, unknown>>> {
	const rows = await fetchProjectPunchList(projectId);
	return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

/* -------------------------------------------------- foto laporan harian (B3) */

function parseIdArray(val: unknown): string[] {
	if (Array.isArray(val)) return val.map((v) => String(v)).filter(Boolean);
	if (typeof val === 'string' && val.trim()) {
		try {
			const p = JSON.parse(val);
			return Array.isArray(p) ? p.map((v) => String(v)).filter(Boolean) : [];
		} catch {
			return [];
		}
	}
	return [];
}

const FOTO_KATEGORI: Record<string, string> = {
	progress_photos: 'Progress',
	attendance_photos: 'Kehadiran',
	issue_photos: 'Kendala',
	weekend_photos: 'Akhir Pekan'
};
const MAX_FOTO = 60; // batas wajar untuk 1 PDF

/**
 * Baris = SATU FOTO. Dipakai endpoint untuk render grid foto (server-side,
 * Gotenberg) — bukan tabel. `fileId` diresolusi jadi gambar di server.
 */
export async function flattenLaporanHarianFotoForField(
	projectId: number,
	opts: FieldExportOpts = {}
): Promise<Array<Record<string, unknown>>> {
	const reports = await getReports(projectId, { limit: 200 });
	const list = Array.isArray(reports) ? (reports as Array<Record<string, unknown>>) : [];
	const out: Array<Record<string, unknown>> = [];
	for (const r of list) {
		const tgl = String((r.tanggal as string) || (r.date as string) || '').slice(0, 10);
		if (!inRange(tgl, opts.dateRange)) continue;
		const ket = String((r.pekerjaan_dilakukan as string) || (r.kendala as string) || '').slice(0, 180);
		for (const [field, kategori] of Object.entries(FOTO_KATEGORI)) {
			for (const fileId of parseIdArray(r[field])) {
				out.push({ tanggal: tgl, kategori, keterangan: ket, fileId });
				if (out.length >= MAX_FOTO) return out;
			}
		}
	}
	return out;
}

/* ------------------------------------------- Fase 6 (Export PDF + Laporan Keuangan): status & mingguan */
// Tanpa angka uang sama sekali (§5.4 P2): hanya progres, kehadiran laporan, dan kualitas. Nilai kontrak, termin
// bernominal, RAP dalam Rupiah, dan margin TIDAK ada di sini — Project Leader melihat sisi biaya lewat RAP vs Aktual.

const num = (v: unknown): number => {
	const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
	return Number.isFinite(n) ? n : 0;
};
const ymd = (v: unknown): string => String(v ?? '').slice(0, 10);
const cut = (s: unknown, n: number): string => {
	const t = String(s ?? '').replace(/\s+/g, ' ').trim();
	return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/** Senin (YYYY-MM-DD, UTC) dari minggu yang memuat tanggal `d`; '' bila tanggal tidak valid. */
export function mingguMulai(d: string): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
	const t = new Date(d + 'T00:00:00Z');
	if (Number.isNaN(t.getTime())) return '';
	const dow = (t.getUTCDay() + 6) % 7; // Senin=0
	t.setUTCDate(t.getUTCDate() - dow);
	return t.toISOString().slice(0, 10);
}

/** Rekap laporan harian per minggu (Senin–Minggu) — bahan Laporan Mingguan untuk customer. Terbaru di atas. */
export function rekapMingguan(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
	const weeks = new Map<string, Array<Record<string, unknown>>>();
	for (const r of Array.isArray(rows) ? rows : []) {
		const w = mingguMulai(ymd(r.tanggal ?? r.date));
		if (!w) continue;
		if (!weeks.has(w)) weeks.set(w, []);
		weeks.get(w)!.push(r);
	}
	return [...weeks.entries()]
		.sort((a, b) => (a[0] < b[0] ? 1 : -1))
		.map(([minggu, list]) => {
			const sorted = [...list].sort((a, b) => (ymd(a.tanggal ?? a.date) < ymd(b.tanggal ?? b.date) ? -1 : 1));
			const kendala = [...new Set(sorted.map((r) => cut(r.kendala, 120)).filter(Boolean))];
			const pekerja = sorted.map((r) => num(r.jumlah_pekerja)).filter((n) => n > 0);
			return {
				minggu_mulai: minggu,
				jumlah_laporan: sorted.length,
				rata_pekerja: pekerja.length ? Math.round((pekerja.reduce((s, n) => s + n, 0) / pekerja.length) * 10) / 10 : 0,
				progress_akhir: num(sorted[sorted.length - 1]?.progress),
				hari_ada_kendala: sorted.filter((r) => cut(r.kendala, 5)).length,
				kendala_utama: kendala.slice(0, 2).join(' | ')
			};
		});
}

const SELESAI = /^(selesai|done|completed|closed|tercapai|100)/i;
const PUNCH_TUTUP = /^(closed|selesai|done|resolved|ditutup|lulus|verified)/i;
const PUNCH_BERAT = /^(critical|kritis|major|high|tinggi|berat)/i;

/** Ringkasan status proyek (indikator | nilai | keterangan). Murni: menerima hasil flattener yang sudah ada. */
export function ringkasStatusProyek(input: {
	timeline: Array<Record<string, unknown>>;
	laporan: Array<Record<string, unknown>>;
	punch: Array<Record<string, unknown>>;
}): Array<Record<string, unknown>> {
	const tl = Array.isArray(input.timeline) ? input.timeline : [];
	const lp = Array.isArray(input.laporan) ? input.laporan : [];
	const pu = Array.isArray(input.punch) ? input.punch : [];
	const out: Array<Record<string, unknown>> = [];

	const level1 = tl.filter((r) => num(r.level) <= 1);
	const basis = level1.length ? level1 : tl;
	const bobot = basis.reduce((s, r) => s + Math.max(0, num(r.weight_pct)), 0);
	const progress = basis.length
		? bobot > 0
			? basis.reduce((s, r) => s + num(r.completion_pct) * Math.max(0, num(r.weight_pct)), 0) / bobot
			: basis.reduce((s, r) => s + num(r.completion_pct), 0) / basis.length
		: null;
	out.push({ indikator: 'Progress keseluruhan (%)', nilai: progress == null ? 'n/a' : (Math.round(progress * 10) / 10).toString(), keterangan: bobot > 0 ? 'Rata-rata berbobot pekerjaan level 1' : 'Rata-rata sederhana (bobot belum diisi)' });
	const selesai = tl.filter((r) => num(r.completion_pct) >= 100 || SELESAI.test(String(r.status ?? ''))).length;
	out.push({ indikator: 'Pekerjaan selesai', nilai: `${selesai} dari ${tl.length}`, keterangan: 'Semua level WBS' });

	const tgl = lp.map((r) => ymd(r.tanggal ?? r.date)).filter(Boolean).sort();
	out.push({ indikator: 'Laporan harian', nilai: String(lp.length), keterangan: tgl.length ? `Terakhir ${tgl[tgl.length - 1]}` : 'Belum ada laporan' });
	out.push({ indikator: 'Laporan dengan kendala', nilai: String(lp.filter((r) => cut(r.kendala, 5)).length), keterangan: 'Kolom Kendala terisi' });

	const terbuka = pu.filter((r) => !PUNCH_TUTUP.test(String(r.status ?? '')));
	out.push({ indikator: 'Punch list terbuka', nilai: `${terbuka.length} dari ${pu.length}`, keterangan: 'Temuan kualitas belum ditutup' });
	out.push({ indikator: 'Punch list berat terbuka', nilai: String(terbuka.filter((r) => PUNCH_BERAT.test(String(r.severity ?? ''))).length), keterangan: 'Severity kritis/mayor/tinggi' });
	return out;
}

export async function flattenStatusProyekForField(projectId: number): Promise<Array<Record<string, unknown>>> {
	// Tiga sumber dimuat paralel; satu yang gagal tidak membuang seluruh ringkasan (ditandai di baris terkait).
	const [tl, lp, pu] = await Promise.allSettled([
		flattenTimelineForField(projectId),
		flattenLaporanHarianForField(projectId),
		flattenPunchListForField(projectId)
	]);
	const gagal = [tl, lp, pu].filter((r) => r.status === 'rejected');
	for (const g of gagal) console.error('[fieldExport] sumber status proyek gagal:', (g as PromiseRejectedResult).reason);
	if (gagal.length === 3) throw new Error('Gagal memuat data status proyek');
	const val = <T,>(r: PromiseSettledResult<T>, fb: T): T => (r.status === 'fulfilled' ? r.value : fb);
	const rows = ringkasStatusProyek({ timeline: val(tl, []), laporan: val(lp, []), punch: val(pu, []) });
	if (gagal.length) rows.push({ indikator: 'Catatan', nilai: `${gagal.length} sumber tidak termuat`, keterangan: 'Sebagian indikator di atas bernilai kosong/0 karena sumbernya gagal dimuat — jangan dibaca sebagai nol sungguhan.' });
	return rows;
}

export async function flattenLaporanMingguanForField(
	projectId: number,
	opts: FieldExportOpts = {}
): Promise<Array<Record<string, unknown>>> {
	return rekapMingguan(await flattenLaporanHarianForField(projectId, opts));
}
