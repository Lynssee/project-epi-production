// src/lib/server/inventorySettings.ts
// SERVER-ONLY. Pembaca ringan system_settings namespace inventory.* untuk endpoint API
// (bukan komponen Svelte — untuk itu pakai $lib/services/inventorySettings.ts di klien).
// Sama seperti versi klien: gagal-lunak ke default, tidak pernah melempar.
import { directusServerJson } from './directus';

/**
 * Baca satu kunci inventory.* dari system_settings sisi server.
 * @param key - mis. "inventory.pilot.project_ids"
 * @param fallback - dipakai bila kunci belum ada / Directus tak terjangkau / parse gagal
 */
export async function getInventorySettingServer<T>(key: string, fallback: T): Promise<T> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=${encodeURIComponent(key)}&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		if (raw == null) return fallback;
		const parsed = JSON.parse(raw);
		// Kunci list yang sengaja dikosongkan (menunggu keputusan pilot) tidak boleh menimpa fallback
		// yang sudah berjalan — array kosong berarti "belum diisi", bukan "kosongkan pilot".
		if (Array.isArray(parsed) && parsed.length === 0 && Array.isArray(fallback) && fallback.length > 0) {
			return fallback;
		}
		return parsed as T;
	} catch (err) {
		console.warn(`[inventorySettings.server] Gagal baca "${key}", pakai fallback.`, err);
		return fallback;
	}
}

const PILOT_PROJECT_IDS_KEY = 'inventory.pilot.project_ids';
const PILOT_PROJECT_IDS_DEFAULT = [846, 526, 722];

/**
 * Gerbang pilot proyek terpadu (Rencana TAJAM v2.0 §3 A3, F0). Sebelum ini ada tiga
 * mekanisme berbeda (opname baca system_settings dgn fallback yg menimpa `[]`, dua endpoint
 * lain hardcode array) -- akibatnya mengisi `[]` di setelan mematikan opname total alih-alih
 * membuka untuk semua proyek. Aturan eksplisit di sini:
 *  - kunci absen/null  -> fallback [846,526,722]
 *  - kunci diisi `[]`  -> null (SEMUA proyek, tanpa pembatasan)
 *  - kunci diisi array -> dipakai apa adanya
 * Sengaja TIDAK memakai getInventorySettingServer() karena fungsi itu menimpa `[]` dengan
 * fallback (perilaku lama yang justru mau diubah di sini).
 */
export async function resolvePilotProjectIds(): Promise<number[] | null> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=${encodeURIComponent(PILOT_PROJECT_IDS_KEY)}&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		if (raw == null) return PILOT_PROJECT_IDS_DEFAULT;
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed) && parsed.length === 0) return null;
		if (Array.isArray(parsed)) return parsed;
		return PILOT_PROJECT_IDS_DEFAULT;
	} catch (err) {
		console.warn('[inventorySettings.server] Gagal baca gerbang pilot, pakai fallback.', err);
		return PILOT_PROJECT_IDS_DEFAULT;
	}
}

/** true bila projectId lolos gerbang pilot. pilotIds === null berarti tanpa pembatasan (semua lolos). */
export function isPilotProject(pilotIds: number[] | null, projectId: number): boolean {
	return pilotIds === null || pilotIds.includes(projectId);
}
