// src/lib/server/fleetApprovalProgress.ts
// Peminjaman 11 §3.2 — progres approval nyata untuk booking `diajukan`, supaya stepper HP menampilkan "Persetujuan (1/2)…"
// sesuai workflow sebenarnya (1 tahap tanpa kendaraan, 2 tahap biasa, 3 tahap luar kota), bukan "Review & Persetujuan GA".
// Semua query TERPISAH per koleksi & di-batch (Aturan #2, hemat API): approval_requests → workflows → steps → matrix → posisi.
// Gagal → dilog & dikembalikan kosong (klien menampilkan "Menunggu persetujuan" tanpa menyebut siapa) — tidak pernah 500.

import { directusServerJson } from '$lib/server/directus';

export interface ApprovalProgress {
	current_step: number;
	total_steps: number;
	step_label: string | null;
	steps: { order: number; label: string | null }[];
}

interface StepRow { workflow_id: string; step_order: number; matrix_id: string | null }

/** Murni & diuji: susun progres dari data mentah. */
export function susunProgress(currentStep: number, stepRows: { order: number; label: string | null }[]): ApprovalProgress | null {
	const steps = [...stepRows].sort((a, b) => a.order - b.order);
	if (!steps.length) return null;
	const cur = Number(currentStep) || 1;
	return {
		current_step: cur,
		total_steps: Math.max(...steps.map((s) => s.order)),
		step_label: steps.find((s) => s.order === cur)?.label ?? null,
		steps
	};
}

const uniq = <T>(a: T[]) => [...new Set(a.filter((x) => x !== null && x !== undefined))] as T[];
const inFilter = (field: string, ids: (string | number)[]) => encodeURIComponent(JSON.stringify({ [field]: { _in: ids } }));

async function get<T>(path: string): Promise<T[]> {
	return (await directusServerJson<{ data: T[] }>(path))?.data || [];
}

/** requestId → progres. Hanya untuk id yang diberikan (pemanggil membatasi ke booking `diajukan`). */
export async function muatApprovalProgress(requestIds: (string | number)[]): Promise<Record<string, ApprovalProgress>> {
	const out: Record<string, ApprovalProgress> = {};
	const ids = uniq(requestIds.map(String));
	if (!ids.length) return out;
	try {
		const reqs = await get<{ id: string; status: string; current_step: number | null; module_key: string }>(
			`/items/approval_requests?filter=${inFilter('id', ids)}&fields=id,status,current_step,module_key&limit=-1`
		);
		const modules = uniq(reqs.map((r) => r.module_key));
		if (!modules.length) return out;
		const wfs = await get<{ id: string; module_key: string }>(
			`/items/approval_workflows?filter=${encodeURIComponent(JSON.stringify({ module_key: { _in: modules }, is_active: { _eq: true } }))}&fields=id,module_key&limit=-1`
		);
		const steps = wfs.length
			? await get<StepRow>(`/items/approval_workflow_steps?filter=${inFilter('workflow_id', wfs.map((w) => w.id))}&fields=workflow_id,step_order,matrix_id&limit=-1`)
			: [];
		const matrixIds = uniq(steps.map((s) => s.matrix_id));
		const matrix = matrixIds.length ? await get<{ id: string; jabatan_id: number | null }>(`/items/approval_matrix?filter=${inFilter('id', matrixIds as string[])}&fields=id,jabatan_id&limit=-1`) : [];
		const jabIds = uniq(matrix.map((m) => m.jabatan_id)) as number[];
		const posisi = jabIds.length ? await get<{ id: number; nama_posisi: string }>(`/items/posisi?filter=${inFilter('id', jabIds)}&fields=id,nama_posisi&limit=-1`) : [];
		const namaPosisi = new Map(posisi.map((p) => [p.id, p.nama_posisi]));
		const jabatanOfMatrix = new Map(matrix.map((m) => [m.id, m.jabatan_id ? namaPosisi.get(m.jabatan_id) || null : null]));

		for (const r of reqs) {
			if (r.status !== 'pending') continue;
			const wf = wfs.find((w) => w.module_key === r.module_key);
			const stepRows = wf
				? steps.filter((s) => s.workflow_id === wf.id).map((s) => ({ order: s.step_order, label: (s.matrix_id && jabatanOfMatrix.get(s.matrix_id)) || null }))
				: [{ order: 1, label: null }]; // tanpa workflow (mis. kunjungan tanpa kendaraan): 1 tahap
			const p = susunProgress(r.current_step || 1, stepRows);
			if (p) out[r.id] = p;
		}
	} catch (e) {
		console.error('[fleetApprovalProgress] gagal memuat progres approval — stepper memakai fallback:', e);
	}
	return out;
}
