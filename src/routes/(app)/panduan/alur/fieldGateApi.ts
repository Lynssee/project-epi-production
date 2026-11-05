// src/routes/(app)/panduan/alur/fieldGateApi.ts
// Klien ringan kartu "Siklus Dokumen & Syarat Lolos Gate" dan pencarian kendala di /panduan/alur. Tidak melempar.
// Hemat kuota HP: gate dimuat HANYA saat kartu dibuka (satu panggilan per alur, cache memori 5 menit) dan salinan terakhir
// disimpan di perangkat supaya di area minim sinyal syarat gate tetap terbaca (ditandai "salinan terakhir"). Pencarian: hasil kecil.
import type { FieldGateInfo } from '../../../api/process-guidance/flows/gateInfo';

export type { FieldGateInfo };
export interface GateInfoResult {
	available: boolean;
	gates: Record<string, FieldGateInfo>;
	partial?: boolean;
	/** true bila ditampilkan dari salinan terakhir di perangkat (server tak terjangkau). */
	stale?: boolean;
	reason?: string;
}
export interface KendalaHit {
	flow_id: string;
	flow_title: string;
	node_id: string;
	node_label: string;
	kind: 'kendala' | 'gate' | 'syarat' | 'langkah';
	snippet: string;
}

interface Deps {
	fetchImpl?: typeof fetch | null;
	getToken?: (() => Promise<string | null>) | null;
	storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
	now?: number;
}

const TTL_MS = 5 * 60 * 1000;
const STORED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const KEY = (id: string) => `epi_flow_gates_v1_${id}`;
const memo = new Map<string, { at: number; result: GateInfoResult }>();

async function authedGet(path: string, deps: Deps, signal?: AbortSignal): Promise<Response> {
	const token = deps.getToken ? await deps.getToken() : await (async () => (await import('$lib/firebase')).auth.currentUser?.getIdToken() ?? null)();
	if (!token) throw new Error('Sesi login tidak ditemukan.');
	return (deps.fetchImpl || fetch)(path, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal });
}

const resolveStorage = (deps: Deps) => (deps.storage !== undefined ? deps.storage : typeof localStorage !== 'undefined' ? localStorage : null);

function readStored(storage: Deps['storage'], id: string, now: number): GateInfoResult | null {
	try {
		const raw = storage?.getItem(KEY(id));
		if (!raw) return null;
		const p = JSON.parse(raw);
		if (!p || typeof p.at !== 'number' || now - p.at > STORED_TTL_MS || !p.gates || typeof p.gates !== 'object') return null;
		return { available: true, gates: p.gates, stale: true };
	} catch {
		return null;
	}
}

/** Gate satu alur. Server gagal/offline → salinan terakhir (stale) bila ada; bila tidak → available:false (kartu tetap menampilkan kunci gate). */
export async function loadGateInfo(flowId: string, deps: Deps = {}): Promise<GateInfoResult> {
	const now = deps.now ?? Date.now();
	const hit = memo.get(flowId);
	if (hit && now - hit.at < TTL_MS) return hit.result;
	const storage = resolveStorage(deps);
	const fallback = (reason: string): GateInfoResult => readStored(storage, flowId, now) ?? { available: false, gates: {}, reason };
	try {
		const res = await authedGet(`/api/process-guidance/flows?gates=${encodeURIComponent(flowId)}`, deps);
		if (!res.ok) return fallback(`HTTP ${res.status}`);
		const body = await res.json();
		if (!body?.success || typeof body.available !== 'boolean') return fallback('Balasan server tidak dikenal.');
		if (!body.available) return fallback(body.reason || 'Panduan gate belum tersedia.');
		const result: GateInfoResult = { available: true, gates: body.gates ?? {}, ...(body.partial ? { partial: true } : {}) };
		memo.set(flowId, { at: now, result });
		try {
			storage?.setItem(KEY(flowId), JSON.stringify({ at: now, gates: result.gates }));
		} catch {
			/* kuota penuh / mode privat: salinan hanya kenyamanan */
		}
		return result;
	} catch (e) {
		console.warn('[fieldGateApi] gate gagal dimuat:', e instanceof Error ? e.message : e);
		return fallback(e instanceof Error ? e.message : 'gagal');
	}
}

export function clearGateInfoMemo(): void {
	memo.clear();
}

/** Pencarian kendala lintas alur (hasil kecil dari server). Gagal/batal → daftar kosong + error. */
export async function searchKendala(q: string, deps: Deps = {}, signal?: AbortSignal): Promise<{ hits: KendalaHit[]; error?: string }> {
	const query = q.trim();
	if (query.length < 2) return { hits: [] };
	try {
		const res = await authedGet(`/api/process-guidance/flows?kendala=${encodeURIComponent(query)}`, deps, signal);
		if (!res.ok) return { hits: [], error: 'Pencarian gagal. Coba lagi saat sinyal membaik.' };
		const body = await res.json();
		return { hits: Array.isArray(body?.hits) ? body.hits : [] };
	} catch (e) {
		if (e instanceof Error && e.name === 'AbortError') return { hits: [] };
		return { hits: [], error: 'Tidak bisa terhubung. Pencarian butuh sinyal.' };
	}
}
