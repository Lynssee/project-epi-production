// src/lib/services/gateSnapshot.ts
// Klien status Dual Gate PA (laporan bolong + MoM sentral) dengan cache memori 3 menit —
// hemat kuota seluler PL. Hanya hasil SUKSES yang di-cache; tidak pernah melempar.
import { getIdToken } from '$lib/services/secureDirectus';

const TTL_MS = 3 * 60 * 1000;
let cache: { key: string; at: number; data: GateSnapshot } | null = null;

export interface GateSnapshot {
	available: boolean;
	days?: string[];
	mom?: { status: 'passed' | 'failed' | 'not_applicable'; message: string };
	projects?: Record<string, { status: 'passed' | 'failed' | 'not_applicable'; missingDates: string[]; dispensasi?: boolean }>;
	/** project_id -> gate_key yang sedang didispensasi GM/Direktur */
	dispensasi?: Record<string, string[]>;
	modes?: { G10_HARIAN?: string; G_MOM_BRIEFING?: string };
	reason?: string;
}

export function invalidateGateSnapshot() {
	cache = null;
}

export async function fetchGateSnapshot(projectIds: Array<number | string>, opts: { force?: boolean } = {}): Promise<GateSnapshot> {
	const ids = [...new Set(projectIds.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
	if (!ids.length) return { available: false, reason: 'tidak ada proyek' };
	const key = ids.join(',');
	if (!opts.force && cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.data;
	try {
		const token = await getIdToken();
		const res = await fetch('/api/laporan/gate-snapshot', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ project_ids: ids })
		});
		const data = (await res.json().catch(() => null)) as GateSnapshot | null;
		if (!res.ok || !data || data.available === false) return { available: false, reason: data?.reason || `HTTP ${res.status}` };
		cache = { key, at: Date.now(), data };
		return data;
	} catch (e: any) {
		return { available: false, reason: e?.message || 'gagal' };
	}
}
