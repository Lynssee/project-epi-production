// src/lib/server/ess/trainingRemedial.ts
// Fase 3 Silabus↔Modul↔Reward: jadwal remedial otomatis TANPA skema baru.
// Saat kuis akhir gagal, enrollment jadi 'Remedial' (sudah ada) dan `tenggat`-nya digeser ke
// hari ini + interval (app_settings training_lms.remedial_interval_hari). Kalender lapangan sudah
// membaca tenggat enrollment berstatus Remedial. Interval 0 / kosong = fitur MATI (perilaku lama).
// SALINAN SETIA util admin: erp-epi/src/lib/utils/trainingRemedial.js.

import { directusServerJson } from '$lib/server/directus';

export const REMEDIAL_MODULE = 'training_lms';
export const REMEDIAL_INTERVAL_KEY = 'remedial_interval_hari';
export const REMEDIAL_INTERVAL_MAX = 90;

/** Normalisasi interval hari: bukan angka / <=0 → 0 (mati); dibatasi maks 90. */
export function normalizeRemedialInterval(raw: unknown): number {
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return Math.min(Math.floor(n), REMEDIAL_INTERVAL_MAX);
}

/** Tanggal remedial (YYYY-MM-DD, kalender WIB) = hari ini WIB + interval hari. null bila fitur mati. */
export function computeRemedialTenggat(now: Date, intervalDays: number): string | null {
	const days = normalizeRemedialInterval(intervalDays);
	if (days === 0) return null;
	const wib = new Date(now.getTime() + 7 * 3600 * 1000);
	wib.setUTCDate(wib.getUTCDate() + days);
	return wib.toISOString().slice(0, 10);
}

/** Satu query, hanya dipanggil saat kuis gagal. Gagal baca → null (fitur dianggap mati) + log jelas. */
export async function getRemedialTenggat(now: Date = new Date()): Promise<string | null> {
	try {
		const res = await directusServerJson<{ data: Array<{ setting_value: unknown }> }>(
			`/items/app_settings?filter[module][_eq]=${REMEDIAL_MODULE}&filter[setting_key][_eq]=${REMEDIAL_INTERVAL_KEY}&fields=setting_value&limit=1`
		);
		return computeRemedialTenggat(now, normalizeRemedialInterval(res?.data?.[0]?.setting_value));
	} catch (e) {
		console.error('[trainingRemedial] gagal membaca setelan remedial_interval_hari, tenggat tidak digeser:', e);
		return null;
	}
}
