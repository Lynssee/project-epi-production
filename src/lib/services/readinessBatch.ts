// src/lib/services/readinessBatch.ts
// Klien tunggal "Kesiapan Proyek Saya" (/api/pengajuan/readiness-batch) dengan cache — dipakai
// widget Home dan /anggaran/cek-gate, supaya buka Home → cek-gate tidak menembak server dua kali
// (hemat kuota seluler PL di lokasi proyek). Cache memori + sessionStorage, TTL 2 menit.
// Hanya hasil SUKSES (available !== false) yang di-cache; gagal tidak pernah mengunci layar.
import { getIdToken } from '$lib/services/secureDirectus';

const TTL_MS = 2 * 60 * 1000;
const mem = new Map<string, { at: number; data: any }>();

const keyOf = (ids: Array<number | string>) => 'readiness:' + [...new Set(ids.map(Number))].sort((a, b) => a - b).join(',');

function readCache(key: string): any | null {
	const hit = mem.get(key);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
	try {
		const raw = sessionStorage.getItem(key);
		if (raw) {
			const p = JSON.parse(raw);
			if (Date.now() - p.at < TTL_MS) {
				mem.set(key, p);
				return p.data;
			}
		}
	} catch { /* sessionStorage tak tersedia */ }
	return null;
}

function writeCache(key: string, data: any) {
	const entry = { at: Date.now(), data };
	mem.set(key, entry);
	try { sessionStorage.setItem(key, JSON.stringify(entry)); } catch { /* abaikan */ }
}

/** Hapus cache (mis. setelah PL melengkapi data lalu menekan muat ulang). */
export function invalidateReadinessCache() {
	mem.clear();
	try {
		for (const k of Object.keys(sessionStorage)) if (k.startsWith('readiness:')) sessionStorage.removeItem(k);
	} catch { /* abaikan */ }
}

/**
 * @returns data server ({projects, siap_count, total_count, ...}) atau
 *          {available:false, projects:[], reason} bila tak terjangkau — tidak pernah melempar.
 */
export async function fetchReadinessBatch(
	projectIds: Array<number | string>,
	opts: { force?: boolean; includeSiap?: boolean } = {}
): Promise<any> {
	if (!projectIds.length) return { projects: [], siap_count: 0, total_count: 0 };
	// includeSiap = tambah `siap_kickoff` (G_SIAP, informasional) — lebih berat di server, jadi opt-in & cache terpisah.
	const key = keyOf(projectIds) + (opts.includeSiap ? ':siap' : '');
	if (!opts.force) {
		const cached = readCache(key);
		if (cached) return cached;
	}
	try {
		const token = await getIdToken();
		const res = await fetch('/api/pengajuan/readiness-batch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ project_ids: projectIds, ...(opts.includeSiap ? { include_siap: true } : {}) })
		});
		const data = await res.json().catch(() => null);
		if (!res.ok || !data) return { available: false, projects: [], reason: `HTTP ${res.status}` };
		if (data.available !== false) writeCache(key, data);
		return data;
	} catch (e: any) {
		return { available: false, projects: [], reason: e?.message || 'Gagal memuat' };
	}
}
