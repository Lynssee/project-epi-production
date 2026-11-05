// src/lib/services/processGuidanceFlowsApi.ts
// Klien alur peta (lapangan): Directus dulu (GET /api/process-guidance/flows) → salinan TERAKHIR yang pernah berhasil (localStorage,
// supaya di area minim sinyal tetap melihat versi terbit terbaru, bukan bawaan lama) → salinan bawaan app (processGuidance.ts).
// Tidak melempar. Cache memori 5 menit; kegagalan tidak di-cache.
import { PROCESS_FLOWS, type ProcessFlow } from '$lib/data/processGuidance';
import { summarizeFlow, type FlowSummary } from '$lib/utils/processMyTasks';
import { validChain, type FlowChain } from '$lib/utils/processHandoffChain';

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

// ───────────────────────── Bentuk ringan (hemat kuota HP) ─────────────────────────
// Seluruh alur ±2 MB; halaman Alur Kerja cukup daftar ringkas + SATU alur yang dibuka. Urutan fallback sama:
// server → salinan terakhir di perangkat → salinan bawaan app. Tidak melempar.

const INDEX_KEY = 'epi_process_flow_index_v1';
const RECENT_KEY = 'epi_process_flows_recent_v1';
const RECENT_MAX = 6;
let indexMemo: { at: number; result: IndexResult } | null = null;
const flowMemo = new Map<string, { at: number; result: FlowResult }>();

export interface IndexResult {
	flows: FlowSummary[];
	source: FlowSource;
	warning?: string;
}
export interface FlowResult {
	flow: ProcessFlow | null;
	source: FlowSource;
	warning?: string;
}

async function authedGet(path: string, deps: Deps): Promise<Response> {
	const token = deps.getToken ? await deps.getToken() : await (async () => (await import('$lib/firebase')).auth.currentUser?.getIdToken() ?? null)();
	if (!token) throw new Error('Sesi login tidak ditemukan.');
	return (deps.fetchImpl || fetch)(path, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
}

function validSummaries(v: unknown): v is FlowSummary[] {
	return Array.isArray(v) && v.every((f) => f && typeof f.id === 'string' && typeof f.title === 'string');
}

export async function loadFlowIndex(deps: Deps = {}): Promise<IndexResult> {
	const now = deps.now ?? Date.now();
	if (indexMemo && now - indexMemo.at < TTL_MS) return indexMemo.result;
	const storage = deps.storage !== undefined ? deps.storage : typeof localStorage !== 'undefined' ? localStorage : null;

	const fallback = (warning: string): IndexResult => {
		try {
			const raw = storage?.getItem(INDEX_KEY);
			const parsed = raw ? JSON.parse(raw) : null;
			if (validSummaries(parsed?.flows)) return { flows: parsed.flows, source: 'cached', warning };
		} catch {
			/* salinan rusak → bawaan app */
		}
		return { flows: PROCESS_FLOWS.map((f) => summarizeFlow(f)), source: 'local', warning };
	};

	try {
		const res = await authedGet('/api/process-guidance/flows?lite=1', deps);
		if (!res.ok) return fallback(`HTTP ${res.status}`);
		const body = await res.json();
		if (body?.source !== 'directus' || !validSummaries(body.flows)) return fallback(body?.warning || 'Server memakai salinan lokal.');
		const result: IndexResult = { flows: body.flows, source: 'directus' };
		indexMemo = { at: now, result };
		try {
			storage?.setItem(INDEX_KEY, JSON.stringify({ at: now, flows: body.flows }));
		} catch {
			/* kuota penuh: cache hanya kenyamanan */
		}
		return result;
	} catch (e) {
		console.warn('[processGuidanceFlowsApi] daftar alur gagal — memakai salinan tersimpan/lokal:', e instanceof Error ? e.message : e);
		return fallback(e instanceof Error ? e.message : 'gagal');
	}
}

function readRecent(storage: Deps['storage']): ProcessFlow[] {
	try {
		const parsed = JSON.parse(storage?.getItem(RECENT_KEY) || 'null');
		return validFlows(parsed?.flows) ? parsed.flows : [];
	} catch {
		return [];
	}
}

export async function loadFlowById(id: string, deps: Deps = {}): Promise<FlowResult> {
	const now = deps.now ?? Date.now();
	const hit = flowMemo.get(id);
	if (hit && now - hit.at < TTL_MS) return hit.result;
	const storage = deps.storage !== undefined ? deps.storage : typeof localStorage !== 'undefined' ? localStorage : null;

	const fallback = (warning: string): FlowResult => {
		const stored = readRecent(storage).find((f) => f.id === id);
		if (stored) return { flow: stored, source: 'cached', warning };
		const local = PROCESS_FLOWS.find((f) => f.id === id);
		return { flow: local ?? null, source: 'local', warning };
	};

	try {
		const res = await authedGet(`/api/process-guidance/flows?id=${encodeURIComponent(id)}`, deps);
		if (res.status === 404) return { flow: null, source: 'directus', warning: 'Alur tidak ditemukan.' };
		if (!res.ok) return fallback(`HTTP ${res.status}`);
		const body = await res.json();
		if (body?.source !== 'directus' || !validFlows([body.flow])) return fallback(body?.warning || 'Server memakai salinan lokal.');
		const result: FlowResult = { flow: body.flow, source: 'directus' };
		flowMemo.set(id, { at: now, result });
		// Simpan hanya beberapa alur terakhir yang dibuka (±10 KB per alur) supaya tetap terbaca saat sinyal hilang.
		try {
			const recent = [body.flow, ...readRecent(storage).filter((f) => f.id !== id)].slice(0, RECENT_MAX);
			storage?.setItem(RECENT_KEY, JSON.stringify({ at: now, flows: recent }));
		} catch {
			/* kuota penuh */
		}
		return result;
	} catch (e) {
		console.warn('[processGuidanceFlowsApi] alur gagal — memakai salinan tersimpan/lokal:', e instanceof Error ? e.message : e);
		return fallback(e instanceof Error ? e.message : 'gagal');
	}
}

export function clearFlowLiteMemo(): void {
	indexMemo = null;
	flowMemo.clear();
	chainMemo.clear();
}

// ───────────────────────── Rantai Serah-Terima (Hulu → alur ini → Hilir) ─────────────────────────
// Bentuk kecil (± beberapa ratus byte). Offline-first: salinan terakhir per alur disimpan di perangkat (maks. 12 alur) sehingga kartu tetap
// tampil saat sinyal hilang. Tidak melempar; gagal & tak ada salinan → chain null (kartu tidak tampil, bukan galat).
const CHAIN_KEY = 'epi_process_chain_v1';
const CHAIN_MAX = 12;
const chainMemo = new Map<string, { at: number; result: ChainResult }>();

export interface ChainResult {
	chain: FlowChain | null;
	source: FlowSource;
	warning?: string;
}

function readChains(storage: Deps['storage']): Record<string, FlowChain> {
	try {
		const parsed = JSON.parse(storage?.getItem(CHAIN_KEY) || 'null');
		return parsed && typeof parsed.items === 'object' && parsed.items ? parsed.items : {};
	} catch {
		return {};
	}
}

export async function loadFlowChain(id: string, deps: Deps = {}): Promise<ChainResult> {
	const now = deps.now ?? Date.now();
	const hit = chainMemo.get(id);
	if (hit && now - hit.at < TTL_MS) return hit.result;
	const storage = deps.storage !== undefined ? deps.storage : typeof localStorage !== 'undefined' ? localStorage : null;

	const fallback = (warning: string): ChainResult => {
		const stored = readChains(storage)[id];
		return validChain(stored) ? { chain: stored, source: 'cached', warning } : { chain: null, source: 'local', warning };
	};

	try {
		const res = await authedGet(`/api/process-guidance/flows?chain=${encodeURIComponent(id)}`, deps);
		if (res.status === 404) return { chain: null, source: 'directus', warning: 'Alur tidak ditemukan.' };
		if (!res.ok) return fallback(`HTTP ${res.status}`);
		const body = await res.json();
		if (body?.source !== 'directus' || !validChain(body.chain)) return fallback(body?.warning || 'Server memakai salinan lokal.');
		const result: ChainResult = { chain: body.chain, source: 'directus' };
		chainMemo.set(id, { at: now, result });
		try {
			const items = readChains(storage);
			delete items[id];
			const keep = Object.entries({ [id]: body.chain, ...items }).slice(0, CHAIN_MAX); // yang terbaru dibuka di depan
			storage?.setItem(CHAIN_KEY, JSON.stringify({ at: now, items: Object.fromEntries(keep) }));
		} catch {
			/* kuota penuh: cache hanya kenyamanan */
		}
		return result;
	} catch (e) {
		console.warn('[processGuidanceFlowsApi] rantai serah-terima gagal — memakai salinan tersimpan:', e instanceof Error ? e.message : e);
		return fallback(e instanceof Error ? e.message : 'gagal');
	}
}

export function clearFlowChainMemo(): void {
	chainMemo.clear();
}
