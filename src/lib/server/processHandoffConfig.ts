// src/lib/server/processHandoffConfig.ts
// ⚠️ SERVER-ONLY. Daftar serah-terima lintas alur untuk aplikasi lapangan.
// Sumber: app_settings (module `process_guidance`, key `grand_map_config`) yang diatur Super Admin di erp-epi (tab 🌐 Peta Grand).
// Bila belum ada/tidak terbaca/tidak punya daftar `handoffs` → BAWAAN (cermin 28 titik serah-terima awal Peta Grand erp-epi).
// 1 query kecil + cache 5 menit; gagal baca TIDAK menggagalkan rantai (memakai bawaan + peringatan).
import { directusServerJson } from '$lib/server/directus';
import { parseHandoffConfig, type ConfigHandoff } from '$lib/utils/processHandoffChain';
import { DEFAULT_HANDOFFS } from '$lib/data/processHandoffDefaults';

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; list: ConfigHandoff[] } | null = null;

export async function loadHandoffConfig({ now = Date.now(), useCache = true } = {}): Promise<ConfigHandoff[]> {
	if (useCache && cache && now - cache.at < TTL_MS) return cache.list;
	let list: ConfigHandoff[] = DEFAULT_HANDOFFS;
	try {
		const res = await directusServerJson<{ data: { setting_value?: unknown }[] }>(
			'/items/app_settings?filter[module][_eq]=process_guidance&filter[setting_key][_eq]=grand_map_config&fields=setting_value&limit=1'
		);
		list = parseHandoffConfig(res?.data?.[0]?.setting_value) ?? DEFAULT_HANDOFFS;
	} catch (e) {
		console.warn('[processHandoffConfig] konfigurasi gagal dibaca — memakai bawaan:', e instanceof Error ? e.message : e);
		return DEFAULT_HANDOFFS; // tidak di-cache: percobaan berikutnya boleh pulih
	}
	cache = { at: now, list };
	return list;
}

export function clearHandoffConfigCache(): void {
	cache = null;
}
