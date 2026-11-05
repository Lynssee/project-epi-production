// src/lib/services/processGuidanceMineApi.ts
// Klien "Tugas Saya di Alur" (GET /api/process-guidance/mine). Tidak melempar. Memo 5 menit; hasil sukses terakhir disimpan di perangkat
// supaya kartu tetap tampil saat sinyal hilang. Kegagalan/jabatan tak terhubung → kartu disembunyikan atau diberi petunjuk, bukan galat.
import type { MyPosisi, MyTask } from '$lib/utils/processMyTasks';
import type { RoleContacts } from '$lib/utils/processHandoffContacts';

export interface MineResult {
	posisi: MyPosisi | null;
	tasks: MyTask[];
	/** alasan jabatan tak terhubung (dari server) */
	reason?: string;
	source: 'directus' | 'cached' | 'none';
	warning?: string;
	/** "Kontak Approver": posisi.id (task.handoff_to) → jabatan + pemegang aktif. Kosong bila belum termuat / salinan perangkat. */
	contacts?: Record<number, RoleContacts>;
}

const TTL_MS = 5 * 60 * 1000;
const STORAGE_KEY = 'epi_process_mine_v1';
let memo: { at: number; uid: string; result: MineResult } | null = null;

interface Deps {
	fetchImpl?: typeof fetch | null;
	getToken?: (() => Promise<string | null>) | null;
	uid?: string;
	storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
	now?: number;
}

const validTasks = (v: unknown): v is MyTask[] => Array.isArray(v) && v.every((t) => t && typeof t.flow_id === 'string' && typeof t.node_id === 'string');

/** Hanya bentuk yang dikenal diterima; selebihnya dibuang (UI tak pernah crash karena kontak rusak). */
function validContacts(v: unknown): Record<number, RoleContacts> {
	const out: Record<number, RoleContacts> = {};
	if (!v || typeof v !== 'object') return out;
	for (const [k, r] of Object.entries(v as Record<string, any>)) {
		if (!r || typeof r.nama !== 'string' || !Array.isArray(r.people)) continue;
		out[Number(k)] = {
			nama: r.nama,
			total: Number(r.total) || r.people.length,
			people: r.people.filter((p: any) => p && typeof p.nama === 'string').map((p: any) => ({ id: Number(p.id), nama: p.nama, wa: typeof p.wa === 'string' ? p.wa : '' }))
		};
	}
	return out;
}

export async function loadMyTasks(deps: Deps = {}): Promise<MineResult> {
	const now = deps.now ?? Date.now();
	const storage = deps.storage !== undefined ? deps.storage : typeof localStorage !== 'undefined' ? localStorage : null;
	let uid = deps.uid ?? 'anon';

	// Salinan terakhir milik pengguna yang sama (jaringan putus = kasus paling umum di lapangan); tidak pernah milik orang lain.
	const fallback = (warning: string): MineResult => {
		try {
			const stored = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
			if (stored?.uid === uid && validTasks(stored.tasks)) return { posisi: stored.posisi ?? null, tasks: stored.tasks, source: 'cached', warning };
		} catch {
			/* salinan rusak */
		}
		return { posisi: null, tasks: [], source: 'none', warning };
	};

	try {
		// Impor malas: firebase tak boleh dimuat saat modul ini diimpor (mis. di tes).
		const fb = deps.getToken ? null : await import('$lib/firebase');
		uid = deps.uid ?? fb?.auth.currentUser?.uid ?? 'anon';
		if (memo && memo.uid === uid && now - memo.at < TTL_MS) return memo.result;

		const token = deps.getToken ? await deps.getToken() : ((await fb!.auth.currentUser?.getIdToken()) ?? null);
		if (!token) return fallback('Sesi login tidak ditemukan.');
		const res = await (deps.fetchImpl || fetch)('/api/process-guidance/mine', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
		if (!res.ok) return fallback(`HTTP ${res.status}`);
		const body = await res.json();
		if (body?.source !== 'directus' || !validTasks(body.tasks)) return fallback(body?.warning || 'Server tidak menjawab.');
		const result: MineResult = { posisi: body.posisi ?? null, tasks: body.tasks, reason: body.reason, source: 'directus', contacts: validContacts(body.contacts) };
		memo = { at: now, uid, result };
		try {
			// Kontak (nomor WA rekan) SENGAJA tidak disimpan di perangkat — hanya tugas; kontak dimuat ulang dari server.
			storage?.setItem(STORAGE_KEY, JSON.stringify({ at: now, uid, posisi: result.posisi, tasks: result.tasks }));
		} catch {
			/* kuota penuh */
		}
		return result;
	} catch (e) {
		console.warn('[processGuidanceMineApi] gagal:', e instanceof Error ? e.message : e);
		return fallback(e instanceof Error ? e.message : 'gagal');
	}
}

export function clearMineMemo(): void {
	memo = null;
}
