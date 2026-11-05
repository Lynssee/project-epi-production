// src/lib/services/processGuidanceTrainingApi.ts
// Klien status training SAYA untuk program yang ditautkan di Peta Alur (GET /api/process-guidance/training?ids=…).
// Tidak melempar; gagal → { ok:false, items:[] } sehingga UI tetap menampilkan tautan training TANPA status (bukan galat layar).
// Memo 3 menit per kumpulan id (status berubah setelah pengguna belajar, jadi tidak dicache lama); permintaan sama berbagi satu panggilan.
import type { StatusSaya } from '$lib/utils/processTraining';

export interface TrainingStatus {
	id: number;
	kode: string;
	judul: string;
	terbit: boolean;
	self_enroll: boolean;
	status_saya: StatusSaya;
	progress: number | null;
	tenggat: string | null;
}
export interface TrainingStatusResult {
	ok: boolean;
	items: TrainingStatus[];
}

const TTL_MS = 3 * 60 * 1000;
const memo = new Map<string, { at: number; result: TrainingStatusResult }>();
const inflight = new Map<string, Promise<TrainingStatusResult>>();

interface Deps {
	fetchImpl?: typeof fetch | null;
	getToken?: (() => Promise<string | null>) | null;
	now?: number;
}

const validItems = (v: unknown): v is TrainingStatus[] => Array.isArray(v) && v.every((p) => p && typeof p.id === 'number' && typeof p.judul === 'string');

export function clearTrainingStatusMemo(): void {
	memo.clear();
	inflight.clear();
}

export async function loadTrainingStatus(ids: number[], deps: Deps = {}): Promise<TrainingStatusResult> {
	const clean = [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).slice(0, 20);
	if (clean.length === 0) return { ok: true, items: [] };
	const key = clean.join(',');
	const now = deps.now ?? Date.now();
	const hit = memo.get(key);
	if (hit && now - hit.at < TTL_MS) return hit.result;
	const running = inflight.get(key);
	if (running) return running;

	const p = (async (): Promise<TrainingStatusResult> => {
		try {
			// Impor malas: firebase tak boleh dimuat saat modul ini diimpor (mis. di tes).
			const token = deps.getToken ? await deps.getToken() : await (async () => (await import('$lib/firebase')).auth.currentUser?.getIdToken() ?? null)();
			if (!token) return { ok: false, items: [] };
			const res = await (deps.fetchImpl || fetch)(`/api/process-guidance/training?ids=${key}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
			if (!res.ok) return { ok: false, items: [] };
			const body = await res.json();
			if (body?.source !== 'directus' || !validItems(body.programs)) return { ok: false, items: [] };
			const result = { ok: true, items: body.programs };
			memo.set(key, { at: now, result });
			return result;
		} catch (e) {
			console.warn('[processGuidanceTrainingApi] gagal:', e instanceof Error ? e.message : e);
			return { ok: false, items: [] };
		}
	})().finally(() => inflight.delete(key));
	inflight.set(key, p);
	return p;
}
