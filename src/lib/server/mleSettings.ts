// src/lib/server/mleSettings.ts
// SERVER-ONLY. Pembaca ringan system_settings namespace mle.* untuk endpoint API
// (bukan komponen Svelte — untuk itu pakai $lib/services/mleSettings.ts di klien).
// Sama pola dengan inventorySettings.ts (server): gagal-lunak ke default, tidak pernah melempar.
import { directusServerJson } from './directus';

/**
 * Baca satu kunci mle.* dari system_settings sisi server.
 * @param key - mis. "mle.equipment.p2h_auto_wo"
 * @param fallback - dipakai bila kunci belum ada / Directus tak terjangkau / parse gagal
 */
export async function getMleSettingServer<T>(key: string, fallback: T): Promise<T> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=${encodeURIComponent(key)}&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		if (raw == null) return fallback;
		return JSON.parse(raw) as T;
	} catch (err) {
		console.warn(`[mleSettings.server] Gagal baca "${key}", pakai fallback.`, err);
		return fallback;
	}
}
