// src/lib/server/processProjectStagesConfig.ts
// ⚠️ SERVER-ONLY. Daftar tahap proyek untuk "Panduan SOP Tahap Ini" dari app_settings (module `process_guidance`, key `project_stages`),
// diatur Super Admin di erp-epi (🧭 Atur Tahap Proyek → Kelola Tahap). Belum ada/tidak terbaca/rusak → BAWAAN. 1 query kecil + cache 5 menit;
// gagal baca TIDAK menggagalkan widget (memakai bawaan) dan tidak di-cache.
import { directusServerJson } from '$lib/server/directus';
import { normalizeStages } from '$lib/utils/projectStageResolver';
import { DEFAULT_PROJECT_STAGES, type ProjectStage } from '$lib/data/processProjectStageDefaults';

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; list: ProjectStage[] } | null = null;

export async function loadProjectStagesConfig({ now = Date.now(), useCache = true } = {}): Promise<ProjectStage[]> {
	if (useCache && cache && now - cache.at < TTL_MS) return cache.list;
	let list: ProjectStage[];
	try {
		const res = await directusServerJson<{ data: { setting_value?: unknown }[] }>(
			'/items/app_settings?filter[module][_eq]=process_guidance&filter[setting_key][_eq]=project_stages&fields=setting_value&limit=1'
		);
		const raw = res?.data?.[0]?.setting_value;
		let parsed: unknown = raw;
		if (typeof raw === 'string') {
			try { parsed = raw.trim() ? JSON.parse(raw) : null; } catch { parsed = null; }
		}
		list = normalizeStages(parsed);
	} catch (e) {
		console.warn('[processProjectStagesConfig] setelan tahap gagal dibaca — memakai bawaan:', e instanceof Error ? e.message : e);
		return normalizeStages(DEFAULT_PROJECT_STAGES); // tidak di-cache: percobaan berikutnya boleh pulih
	}
	cache = { at: now, list };
	return list;
}

export function clearProjectStagesConfigCache(): void {
	cache = null;
}
