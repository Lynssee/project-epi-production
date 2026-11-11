// src/lib/services/processGuidanceStageApi.ts
// Klien "Panduan SOP Tahap Ini" (GET /api/process-guidance/flows?tahap=1): hanya alur ber-tahap_proyek + daftar tahap. Tidak melempar;
// memo 5 menit; kegagalan → hasil kosong (widget diam) dan TIDAK di-memo. Tanpa salinan perangkat: widget bersifat tambahan, bukan jalur kritis.
import type { ProjectStage } from '$lib/data/processProjectStageDefaults';
import { normalizeStages, type StageFlow } from '$lib/utils/projectStageResolver';

export interface StageData {
	stages: ProjectStage[];
	flows: StageFlow[];
	source: 'directus' | 'none';
	warning?: string;
}

const TTL_MS = 5 * 60 * 1000;
let memo: { at: number; result: StageData } | null = null;

interface Deps {
	fetchImpl?: typeof fetch | null;
	getToken?: (() => Promise<string | null>) | null;
	now?: number;
}

const EMPTY = (warning?: string): StageData => ({ stages: [], flows: [], source: 'none', ...(warning ? { warning } : {}) });

const validFlow = (f: any): f is StageFlow => f && typeof f.id === 'string' && typeof f.title === 'string' && Array.isArray(f.tahap_proyek) && f.tahap_proyek.length > 0;

export async function loadStageFlows(deps: Deps = {}): Promise<StageData> {
	const now = deps.now ?? Date.now();
	if (memo && now - memo.at < TTL_MS) return memo.result;
	try {
		// Impor malas: firebase tak boleh dimuat saat modul ini diimpor (mis. di tes).
		const token = deps.getToken ? await deps.getToken() : await (async () => (await import('$lib/firebase')).auth.currentUser?.getIdToken() ?? null)();
		if (!token) return EMPTY('Sesi login tidak ditemukan.');
		const res = await (deps.fetchImpl || fetch)('/api/process-guidance/flows?tahap=1', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
		if (!res.ok) return EMPTY(`HTTP ${res.status}`);
		const body = await res.json();
		if (body?.source !== 'directus' || !Array.isArray(body.flows)) return EMPTY(body?.warning || 'Server tidak menjawab.');
		const flows: StageFlow[] = body.flows.filter(validFlow);
		const result: StageData = { stages: flows.length ? normalizeStages(body.stages) : [], flows, source: 'directus' };
		memo = { at: now, result };
		return result;
	} catch (e) {
		console.warn('[processGuidanceStageApi] gagal:', e instanceof Error ? e.message : e);
		return EMPTY(e instanceof Error ? e.message : 'gagal');
	}
}

export function clearStageMemo(): void {
	memo = null;
}
