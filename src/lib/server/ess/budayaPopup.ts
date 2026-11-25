// src/lib/server/ess/budayaPopup.ts
// Engine popup berbasis momen + microquiz untuk aplikasi LAPANGAN (Rencana Popup Motivasi/Tips/SOP, Fase 4).
// Salinan setia (dengan penyesuaian audiens 'lapangan' & pola kerja) dari erp-epi/src/lib/server/ess/budayaPopup.js.
//   • SATU payload per hari untuk semua momen (klien menyimpan di localStorage → tetap jalan saat tanpa sinyal).
//   • Kolom Fase 6 dibaca TERPISAH & fail-soft (CLAUDE.md #1/#2). Microquiz dinilai di SERVER; kunci tak pernah ke klien.
//   • Popup tidak pernah memblokir absen. Gagal baca = tanpa popup (dilog).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { resolveKaryawanPolaKerja } from '$lib/server/ess/polaKerjaResolver';
import { loadCultureSettings, loadPropagandaAktif } from './budayaHarian';
import {
	PROPAGANDA_FIELDS_FASE6, ACK_STATUS, ACK_DONE, isActiveOn, matchesAudience, normalizeList, hasKuis, type CultureSettingValue
} from './cultureModel';
import {
	cs, normalizeMomen, normalizeDays, normalizeTimes, isoDow, popupBehavior, isMicroquizEligible, pickMicroquiz, toClientMicroquiz, gradeMicroquiz
} from './cultureMoment';

type Settings = Record<string, CultureSettingValue>;
interface Karyawan { id: number; divisi?: string | null; posisi?: string | null }

// ── Penghitung percobaan microquiz: token bertanda tangan (HMAC) agar konsisten lintas instance server ──
// Token = base64url(JSON{k,p,y,n}).hmac; dikirim balik klien pada coba ulang. Tanpa secret di env → hanya memori instance.
// percobaan = max(token, memori) sehingga membuang token tidak menambah jatah di instance yang sama.
const attemptSecret = (): string => process.env.MICROQUIZ_ATTEMPT_SECRET || process.env.AUTOMATION_SERVER_SECRET || process.env.TRAINING_CERT_VERIFY_SECRET || '';
export function signAttempt(k: number, p: number, y: string, n: number): string | null {
	const sec = attemptSecret();
	if (!sec) return null;
	const body = Buffer.from(JSON.stringify({ k, p, y, n })).toString('base64url');
	return `${body}.${createHmac('sha256', sec).update(body).digest('base64url')}`;
}
/** Jumlah percobaan dari token yang SAH untuk (karyawan, konten, hari) ini; selain itu 0. */
export function readAttempt(token: unknown, k: number, p: number, y: string): number {
	const sec = attemptSecret();
	if (!sec || typeof token !== 'string' || !token.includes('.')) return 0;
	const [body, sig] = token.split('.');
	const good = createHmac('sha256', sec).update(body).digest('base64url');
	try {
		if (sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return 0;
		const d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
		return d.k === k && String(d.p) === String(p) && d.y === y ? Math.max(0, Math.min(5, Number(d.n) || 0)) : 0;
	} catch {
		return 0;
	}
}

let f6Cache: { at: number; ttl: number; supported: boolean; map: Map<number, any> } | null = null;
const attempts = new Map<string, number>(); // `${karyawanId}:${propagandaId}:${ymd}` → jumlah jawaban salah (memori instance)

export function invalidateBudayaPopupCache(): void {
	f6Cache = null;
}

export class PopupError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

async function loadFase6(ttlSec: unknown) {
	const ttl = Math.max(30, Number(ttlSec) || 120) * 1000;
	if (f6Cache && Date.now() - f6Cache.at < f6Cache.ttl) return f6Cache;
	let supported = false;
	const map = new Map<number, any>();
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/culture_propaganda?filter[aktif][_eq]=true&fields=id,${PROPAGANDA_FIELDS_FASE6.join(',')}&limit=-1`
		);
		for (const r of res?.data || []) if (r?.id != null) map.set(r.id, r);
		supported = true;
	} catch (e) {
		console.warn('[budayaPopup] kolom popup/microquiz belum didukung skema (fase 6 belum diterapkan?):', (e as Error)?.message);
	}
	f6Cache = { at: Date.now(), ttl: supported ? ttl : 60_000, supported, map };
	return f6Cache;
}

const isTargeted = (list: unknown, v: unknown) => {
	const l = normalizeList(list).map((s) => s.toLowerCase());
	return !l.length || l.includes(String(v ?? '').trim().toLowerCase());
};

async function popupCandidates(karyawan: Karyawan, ymd: string, settings: Settings) {
	const [base, f6] = await Promise.all([loadPropagandaAktif(), loadFase6(cs(settings, 'popup_cache_ttl_detik'))]);
	if (!f6.supported) return { supported: false, items: [] as any[] };
	const dow = isoDow(ymd);
	let pola: string | null = null; // dihitung malas: hanya bila ada konten yang dibatasi pola kerja
	const items: any[] = [];
	for (const b of base) {
		const row = { ...b, ...(f6.map.get(b.id) || {}) };
		const mode = String(row.display_mode ?? 'banner').toLowerCase();
		if (mode === 'banner' || !normalizeMomen(row.trigger_moments).length) continue;
		if (!isActiveOn(row, ymd) || !matchesAudience(row, 'lapangan', karyawan?.divisi || '')) continue;
		const days = normalizeDays(row.active_days);
		if (days.length && !days.includes(dow)) continue;
		if (!isTargeted(row.target_roles, karyawan?.posisi)) continue;
		if (normalizeList(row.target_pola_kerja).length) {
			if (pola === null) {
				try {
					pola = await resolveKaryawanPolaKerja(karyawan.id, {
						polaKerja: (karyawan as any)?.pola_kerja,
						divisi: karyawan?.divisi
					});
				} catch (e) {
					console.warn('[budayaPopup] pola kerja tidak terbaca (konten berbatas pola dilewati):', (e as Error)?.message);
					pola = '';
				}
			}
			if (!isTargeted(row.target_pola_kerja, pola)) continue;
		}
		if (!String(row.isi_pesan ?? '').trim()) continue;
		items.push(row);
	}
	return { supported: true, items };
}

async function loadMyKuisHistory(karyawanId: number, ids: number[]): Promise<any[]> {
	if (karyawanId == null || !ids.length) return [];
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/culture_propaganda_ack?filter[karyawan_id][_eq]=${karyawanId}&filter[propaganda_id][_in]=${ids.join(',')}&fields=id,propaganda_id,status_aksi,tanggal&limit=-1`
		);
		return res?.data || [];
	} catch (e) {
		console.error('[budayaPopup] gagal baca riwayat ack karyawan:', (e as Error)?.message);
		return [];
	}
}

const SETTING_KEYS = [
	'popup_enabled', 'popup_momen_clock_in', 'popup_momen_break_out', 'popup_momen_break_in', 'popup_momen_clock_out', 'popup_momen_app_open', 'popup_momen_scheduled_time',
	'popup_timing_default', 'popup_rotasi', 'popup_min_gap_menit', 'popup_max_per_hari', 'microquiz_enabled'
];
function pickSettings(settings: Settings): Settings {
	const out: Settings = {};
	for (const k of SETTING_KEYS) out[`culture.${k}`] = cs(settings, k);
	return out;
}

export interface PopupPayload {
	enabled: boolean;
	ymd: string | null;
	settings: Settings;
	items: any[];
}

export async function getPopupPayload(karyawan: Karyawan): Promise<PopupPayload> {
	const ymd = todayJakarta();
	const settings = await loadCultureSettings();
	const empty: PopupPayload = { enabled: false, ymd, settings: {}, items: [] };
	if (cs(settings, 'popup_enabled') !== true) return empty;
	const { supported, items } = await popupCandidates(karyawan, ymd, settings);
	if (!supported || !items.length) return { ...empty, enabled: supported, settings: pickSettings(settings) };

	const history = await loadMyKuisHistory(karyawan?.id, items.map((i) => i.id));
	const kuisIds = new Set(items.filter((i) => hasKuis(i)).map((i) => i.id));
	const kuisHistory = history.filter((h) => kuisIds.has(h.propaganda_id));
	const eligibleIds = new Set<number>();
	let pool = items;
	let pick = pickMicroquiz(pool, kuisHistory, ymd, settings); // null bila kuota habis / tak ada yang jatuh tempo
	while (pick) {
		eligibleIds.add(pick.id);
		const pid = pick.id;
		pool = pool.filter((i) => i.id !== pid);
		pick = pickMicroquiz(pool, kuisHistory, ymd, settings);
	}
	const ackById = new Map<number, string>(history.map((h) => [h.propaganda_id, h.status_aksi]));
	return {
		enabled: true,
		ymd,
		settings: pickSettings(settings),
		items: items.map((i) => ({
			id: i.id,
			judul: String(i.judul ?? ''),
			isi_pesan: String(i.isi_pesan ?? ''),
			tipe: String(i.tipe ?? ''),
			target_audiens: 'semua', // sudah difilter server
			aktif: true,
			display_mode: String(i.display_mode ?? 'popup'),
			trigger_moments: normalizeMomen(i.trigger_moments),
			timing_absen: i.timing_absen || null,
			scheduled_times: normalizeTimes(i.scheduled_times),
			popup_behavior: popupBehavior(i.popup_behavior),
			prioritas: Number(i.prioritas ?? 0) || 0,
			urgent_sampai: i.urgent_sampai || null,
			sop_document_id: Number(i.sop_document_id) > 0 ? Number(i.sop_document_id) : null,
			microquiz: eligibleIds.has(i.id) ? toClientMicroquiz(i) : null,
			selesai: ACK_DONE.has(ackById.get(i.id) as string)
		}))
	};
}

async function findItem(karyawan: Karyawan, propagandaId: unknown) {
	const ymd = todayJakarta();
	const settings = await loadCultureSettings();
	if (cs(settings, 'popup_enabled') !== true) return { ymd, settings, item: null as any };
	const { items } = await popupCandidates(karyawan, ymd, settings);
	return { ymd, settings, item: items.find((i) => String(i.id) === String(propagandaId)) || null };
}

async function myAck(karyawanId: number, propagandaId: number) {
	const res = await directusServerJson<{ data: any[] }>(
		`/items/culture_propaganda_ack?filter[propaganda_id][_eq]=${propagandaId}&filter[karyawan_id][_eq]=${karyawanId}&fields=id,status_aksi,tanggal&limit=1`
	);
	return res?.data?.[0] || null;
}

/** Kolom Fase 6 di ack (momen, percobaan) opsional — ditolak karena skema → ulangi tanpa kolom itu (dilog, bukan ditelan diam-diam). */
async function writeAck(existing: { id?: number } | null, body: Record<string, unknown>, extra: Record<string, unknown>) {
	const send = (payload: Record<string, unknown>) =>
		existing?.id != null
			? directusServerJson(`/items/culture_propaganda_ack/${existing.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
			: directusServerJson('/items/culture_propaganda_ack', { method: 'POST', body: JSON.stringify(payload) });
	try {
		await send({ ...body, ...extra });
	} catch (e) {
		console.warn('[budayaPopup] tulis ack dengan kolom Fase 6 gagal, ulangi tanpa momen/percobaan:', (e as Error)?.message);
		await send(body);
	}
}

export async function submitPopupAck(karyawan: Karyawan, input: { propagandaId: unknown; momen?: unknown }): Promise<{ status: string | null; selesai: boolean }> {
	if (karyawan?.id == null) throw new PopupError('Karyawan tidak dikenali.', 400);
	const { ymd, item } = await findItem(karyawan, input.propagandaId);
	if (!item) throw new PopupError('Konten popup sudah tidak berlaku. Muat ulang halaman.', 409);
	if (hasKuis(item)) return { status: null, selesai: false }; // berkuis diselesaikan lewat microquiz
	const existing = await myAck(karyawan.id, item.id);
	if (existing && ACK_DONE.has(existing.status_aksi)) return { status: existing.status_aksi, selesai: true };
	await writeAck(existing, { propaganda_id: item.id, karyawan_id: karyawan.id, tanggal: ymd, status_aksi: ACK_STATUS.PAHAM }, { momen: normalizeMomen(input.momen)[0] || null });
	return { status: ACK_STATUS.PAHAM, selesai: true };
}

export async function submitMicroquizAnswer(
	karyawan: Karyawan,
	input: { propagandaId: unknown; jawabanIdx: unknown; momen?: unknown; token?: unknown }
) {
	if (karyawan?.id == null) throw new PopupError('Karyawan tidak dikenali.', 400);
	const { ymd, settings, item } = await findItem(karyawan, input.propagandaId);
	if (!item || !isMicroquizEligible(item, settings)) throw new PopupError('Microquiz sudah tidak berlaku. Muat ulang halaman.', 409);
	const existing = await myAck(karyawan.id, item.id);
	if (existing && String(existing.tanggal ?? '').slice(0, 10) === ymd && (existing.status_aksi === ACK_STATUS.KUIS_BENAR || existing.status_aksi === ACK_STATUS.KUIS_SALAH)) {
		return { sudah_dijawab: true, status_aksi: existing.status_aksi, benar: existing.status_aksi === ACK_STATUS.KUIS_BENAR, boleh_ulang: false };
	}
	const key = `${karyawan.id}:${item.id}:${ymd}`;
	const tried = Math.max(attempts.get(key) || 0, readAttempt(input.token, karyawan.id, item.id, ymd));
	if (tried === 0) {
		try {
			const res = await directusServerJson<{ data: any[] }>(
				`/items/culture_propaganda_ack?filter[karyawan_id][_eq]=${karyawan.id}&filter[tanggal][_eq]=${ymd}&filter[status_aksi][_in]=${ACK_STATUS.KUIS_BENAR},${ACK_STATUS.KUIS_SALAH}&aggregate[count]=*`
			);
			if (Number(res?.data?.[0]?.count ?? 0) >= Number(cs(settings, 'microquiz_max_per_hari'))) throw new PopupError('Kuota microquiz hari ini sudah terpakai.', 409);
		} catch (e) {
			if (e instanceof PopupError) throw e;
			console.error('[budayaPopup] gagal cek kuota microquiz harian (dilewati):', (e as Error)?.message);
		}
	}
	const grade = gradeMicroquiz(item, input.jawabanIdx, tried + 1, settings);
	if (!grade.valid) throw new PopupError('Jawaban tidak valid.', 400);
	if (grade.status_aksi) {
		attempts.delete(key);
		await writeAck(
			existing,
			{ propaganda_id: item.id, karyawan_id: karyawan.id, tanggal: ymd, status_aksi: grade.status_aksi },
			{ momen: normalizeMomen(input.momen)[0] || null, percobaan: grade.percobaan }
		);
	} else {
		attempts.set(key, tried + 1);
		if (attempts.size > 5000) attempts.clear();
	}
	return {
		benar: !!grade.benar, boleh_ulang: !!grade.boleh_ulang, status_aksi: grade.status_aksi, kunci_idx: grade.kunci_idx, penjelasan: grade.penjelasan,
		token: grade.boleh_ulang ? signAttempt(karyawan.id, item.id, ymd, tried + 1) : null
	};
}
