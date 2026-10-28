// src/lib/server/processGuidanceFlows.ts
// ⚠️ SERVER-ONLY. Alur TERBIT untuk aplikasi lapangan dari koleksi `process_guidance_flows` (SATU Directus dengan erp-epi; dikelola
// di erp-epi /settings/process-guidance). Satu query tanpa relasi + cache 5 menit. Gagal baca → MELEMPAR (endpoint → fallback salinan lokal);
// kegagalan tidak di-cache. Draft/arsip tidak pernah sampai ke sini (filter status=published).
import { directusServerJson } from '$lib/server/directus';
import { normalizeFlowRow } from '$lib/utils/processGuidanceFlowRow';
import type { ProcessFlow } from '$lib/data/processGuidance';

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; flows: ProcessFlow[] } | null = null;

const FIELDS = 'flow_key,title,description,target_app,urutan,version,definition';

export async function loadPublishedFlowsForField({ now = Date.now(), useCache = true } = {}): Promise<ProcessFlow[]> {
	if (useCache && cache && now - cache.at < TTL_MS) return cache.flows;

	const res = await directusServerJson<{ data: any[] }>(
		`/items/process_guidance_flows?filter[status][_eq]=published&filter[target_app][_in]=project-epi,both&sort=urutan,id&fields=${FIELDS}&limit=-1`
	);
	const flows: ProcessFlow[] = [];
	for (const row of Array.isArray(res?.data) ? res.data : []) {
		const n = normalizeFlowRow(row);
		if (!n) {
			console.warn(`[processGuidanceFlows] alur ${row?.flow_key ?? '(tanpa key)'} dilewati: definisi tidak layak`);
			continue;
		}
		if (n.dropped.length) console.warn(`[processGuidanceFlows] ${n.flow.id}: bagian dibuang saat normalisasi:`, n.dropped);
		flows.push(n.flow);
	}
	cache = { at: now, flows };
	return flows;
}

export function clearProcessGuidanceFlowsCache(): void {
	cache = null;
}
