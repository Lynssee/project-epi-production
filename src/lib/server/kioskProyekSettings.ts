// src/lib/server/kioskProyekSettings.ts
// Pembaca system_settings namespace kiosk_proyek.* untuk sisi lapangan (Rencana Kiosk Proyek, Fase 1).
// Kunci & default HARUS sama dengan erp-epi src/lib/config/kioskProyekSettings.js (yang menulisnya
// lewat /settings/kiosk → tab Kiosk Proyek). Kunci tak dikenal diabaikan; nilai tak valid → default.
// Satu request, cache 5 menit; Directus gagal → default (kiosk tetap MATI karena aktif=false).

import { directusServerJson } from '$lib/server/directus';

export interface KioskProyekSettings {
	'kiosk_proyek.aktif': boolean;
	'kiosk_proyek.perangkat_masa_berlaku_hari': number;
	'kiosk_proyek.aktivasi_qr_detik': number;
	'kiosk_proyek.kode_harian_mode': 'harian' | 'nonaktif';
	'kiosk_proyek.absen_rekan_batas_per_hari': number;
	'kiosk_proyek.jendela_masuk_mulai': string;
	'kiosk_proyek.jendela_masuk_selesai': string;
	'kiosk_proyek.jendela_pulang_mulai': string;
	'kiosk_proyek.jendela_pulang_selesai': string;
	'kiosk_proyek.foto_maks_kb': number;
	'kiosk_proyek.roster_cache_detik': number;
	'kiosk_proyek.catatan_aktif': boolean;
	'kiosk_proyek.catatan_kategori_progres': string[];
	'kiosk_proyek.catatan_kategori_kendala': string[];
	'kiosk_proyek.catatan_maks_per_orang_per_hari': number;
	'kiosk_proyek.pemakaian_aktif': boolean;
	'kiosk_proyek.pemakaian_foto_wajib': boolean;
	'kiosk_proyek.pemakaian_maks_per_orang_per_hari': number;
}

export const KIOSK_PROYEK_DEFAULTS: KioskProyekSettings = {
	'kiosk_proyek.aktif': false,
	'kiosk_proyek.perangkat_masa_berlaku_hari': 30,
	'kiosk_proyek.aktivasi_qr_detik': 120,
	'kiosk_proyek.kode_harian_mode': 'harian',
	'kiosk_proyek.absen_rekan_batas_per_hari': 15,
	'kiosk_proyek.jendela_masuk_mulai': '05:00',
	'kiosk_proyek.jendela_masuk_selesai': '11:00',
	'kiosk_proyek.jendela_pulang_mulai': '14:00',
	'kiosk_proyek.jendela_pulang_selesai': '23:00',
	'kiosk_proyek.foto_maks_kb': 150,
	'kiosk_proyek.roster_cache_detik': 60,
	'kiosk_proyek.catatan_aktif': true,
	'kiosk_proyek.catatan_kategori_progres': ['Progres kerja', 'Hasil kerja', 'Lainnya'],
	'kiosk_proyek.catatan_kategori_kendala': ['Kendala', 'K3 / bahaya', 'Bahan / alat habis'],
	'kiosk_proyek.catatan_maks_per_orang_per_hari': 10,
	'kiosk_proyek.pemakaian_aktif': true,
	'kiosk_proyek.pemakaian_foto_wajib': true,
	'kiosk_proyek.pemakaian_maks_per_orang_per_hari': 20
};

const RANGE: Record<string, [number, number]> = {
	'kiosk_proyek.perangkat_masa_berlaku_hari': [1, 365],
	'kiosk_proyek.aktivasi_qr_detik': [30, 600],
	'kiosk_proyek.absen_rekan_batas_per_hari': [0, 200],
	'kiosk_proyek.foto_maks_kb': [50, 1024],
	'kiosk_proyek.roster_cache_detik': [0, 600],
	'kiosk_proyek.catatan_maks_per_orang_per_hari': [0, 100],
	'kiosk_proyek.pemakaian_maks_per_orang_per_hari': [0, 200]
};
/** Daftar pilihan dari array / teks satu-baris-satu-item. HARUS sama dengan parseKioskProyekList di erp-epi. */
export function parseDaftar(v: unknown): string[] {
	const arr: unknown[] = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\r?\n/) : [];
	const out: string[] = [];
	for (const x of arr) {
		const t = String(x ?? '').trim().slice(0, 40);
		if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
		if (out.length >= 12) break;
	}
	return out;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Murni (dites): gabungkan baris system_settings mentah dengan default. */
export function mergeKioskProyekRows(rows: Array<{ setting_key?: string; setting_value?: unknown }> | null | undefined): KioskProyekSettings {
	const out: Record<string, unknown> = { ...KIOSK_PROYEK_DEFAULTS };
	for (const row of rows || []) {
		const key = row?.setting_key;
		if (!key || !(key in KIOSK_PROYEK_DEFAULTS)) continue;
		let v: unknown = row.setting_value;
		if (typeof v === 'string') {
			try { v = JSON.parse(v); } catch { /* string mentah */ }
		}
		const def = (KIOSK_PROYEK_DEFAULTS as unknown as Record<string, unknown>)[key];
		if (Array.isArray(def)) {
			const arr = parseDaftar(v);
			out[key] = arr.length ? arr : def;
		} else if (typeof def === 'boolean') {
			out[key] = v === true || v === 'true' ? true : v === false || v === 'false' ? false : def;
		} else if (typeof def === 'number') {
			const n = Number(v);
			const [lo, hi] = RANGE[key] || [-Infinity, Infinity];
			out[key] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
		} else if (key === 'kiosk_proyek.kode_harian_mode') {
			out[key] = v === 'harian' || v === 'nonaktif' ? v : def;
		} else {
			out[key] = typeof v === 'string' && TIME_RE.test(v) ? v : def;
		}
	}
	return out as unknown as KioskProyekSettings;
}

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; value: KioskProyekSettings } | null = null;

export async function getKioskProyekSettings(force = false): Promise<KioskProyekSettings> {
	if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_starts_with]=kiosk_proyek.&fields=setting_key,setting_value&limit=-1`
		);
		cache = { at: Date.now(), value: mergeKioskProyekRows(res?.data) };
	} catch (e) {
		console.warn('[kioskProyekSettings] Directus tak terjangkau — pakai default:', (e as Error)?.message);
		cache = { at: Date.now() - TTL_MS + 30_000, value: { ...KIOSK_PROYEK_DEFAULTS } }; // coba lagi ±30 dtk
	}
	return cache.value;
}
