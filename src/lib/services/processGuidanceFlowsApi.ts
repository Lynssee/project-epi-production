// src/lib/services/processGuidanceFlowsApi.ts
// Klien alur peta (lapangan): Directus dulu (GET /api/process-guidance/flows) → salinan TERAKHIR yang pernah berhasil (localStorage,
// supaya di area minim sinyal tetap melihat versi terbit terbaru, bukan bawaan lama) → salinan bawaan app (processGuidance.ts).
// Tidak melempar. Cache memori 5 menit; kegagalan tidak di-cache.
import { PROCESS_FLOWS, type ProcessFlow } from '$lib/data/processGuidance';

export type FlowSource = 'directus' | 'cached' | 'local';
export interface FlowsResult {
	flows: ProcessFlow[];
	source: FlowSource;
	warning?: string;
}

const TTL_MS = 5 * 60 * 1000;
const STORAGE_KEY = 'epi_process_flows_v1';
let memo: { at: number; result: FlowsResult } | null = null;

interface Deps {
	fetchImpl?: typeof fetch | null;
	getToken?: (() => Promise<string | null>) | null;
	storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
	now?: number;
}

function validFlows(v: unknown): v is ProcessFlow[] {
	return Array.isArray(v) && v.every((f) => f && typeof f.id === 'string' && Array.isArray(f.lanes) && Array.isArray(f.nodes) && Array.isArray(f.edges));
}

function readStored(storage: Deps['storage']): ProcessFlow[] | null {
	try {
		const raw = storage?.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		return validFlows(parsed?.flows) ? parsed.flows : null;
	} catch {
		return null;
	}
}

function writeStored(storage: Deps['storage'], flows: ProcessFlow[]): void {
	try {
		storage?.setItem(STORAGE_KEY, JSON.stringify({ at: Date.now(), flows }));
	} catch {
		/* kuota penuh / mode privat: cache hanya kenyamanan */
	}
}

export async function loadProcessFlows(deps: Deps = {}): Promise<FlowsResult> {
	const now = deps.now ?? Date.now();
	if (memo && now - memo.at < TTL_MS) return memo.result;
	const storage = deps.storage !== undefined ? deps.storage : typeof localStorage !== 'undefined' ? localStorage : null;

	const fallback = (warning: string): FlowsResult => {
		const stored = readStored(storage);
		return stored ? { flows: stored, source: 'cached', warning } : { flows: PROCESS_FLOWS, source: 'local', warning };
	};

	try {
		// Impor malas: firebase tak boleh dimuat saat modul ini diimpor (mis. di tes).
		const token = deps.getToken ? await deps.getToken() : await (async () => (await import('$lib/firebase')).auth.currentUser?.getIdToken() ?? null)();
		if (!token) return fallback('Sesi login tidak ditemukan.');
		const res = await (deps.fetchImpl || fetch)('/api/process-guidance/flows', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
		if (!res.ok) return fallback(`HTTP ${res.status}`);
		const body = await res.json();
		if (body?.source !== 'directus' || !validFlows(body.flows)) return fallback(body?.warning || 'Server memakai salinan lokal.');
		const result: FlowsResult = { flows: body.flows, source: 'directus' };
		memo = { at: now, result };
		writeStored(storage, body.flows);
		return result;
	} catch (e) {
		console.warn('[processGuidanceFlowsApi] gagal — memakai salinan tersimpan/lokal:', e instanceof Error ? e.message : e);
		return fallback(e instanceof Error ? e.message : 'gagal');
	}
}

export function clearProcessFlowsMemo(): void {
	memo = null;
}
