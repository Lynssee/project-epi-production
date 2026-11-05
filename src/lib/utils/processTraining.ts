// src/lib/utils/processTraining.ts
// Cermin processTrainingIndex.js (trainingForNode) + kategoriEnrollment di erp-epi — satu aturan tautan alur ↔ training di kedua dashboard.
// Murni, dites. `wajib` HANYA informasi (tidak memicu enrollment).
import type { ProcessFlow } from '$lib/data/processGuidance';

export interface NodeTraining {
	program_id: number;
	/** 'langkah' = tautan khusus langkah, 'alur' = tautan tingkat alur (berlaku untuk semua langkah) */
	scope: 'langkah' | 'alur';
	wajib: boolean;
	catatan: string;
}

/** Program yang berlaku untuk satu langkah: tautan langkah + tautan alur (langkah menang untuk scope; wajib/catatan dari alur). */
export function trainingForNode(flow: Pick<ProcessFlow, 'training' | 'nodes'> | null | undefined, nodeId: string): NodeTraining[] {
	const out = new Map<number, NodeTraining>();
	const node = (flow?.nodes || []).find((n) => n?.id === nodeId);
	for (const raw of node?.training_ids || []) {
		const id = Number(raw);
		if (id > 0) out.set(id, { program_id: id, scope: 'langkah', wajib: false, catatan: '' });
	}
	for (const t of flow?.training || []) {
		const id = Number(t?.program_id);
		if (!(id > 0)) continue;
		const cur = out.get(id);
		const wajib = t.wajib === true;
		const catatan = t.catatan || '';
		out.set(id, cur ? { ...cur, wajib, catatan } : { program_id: id, scope: 'alur', wajib, catatan });
	}
	return [...out.values()];
}

export type StatusSaya = 'lulus' | 'berjalan' | 'belum';

/** Status enrollment → kategori. Lulus = selesai; Enrolled/Ongoing/Remedial = berjalan; lainnya (batal, dll.) = belum. */
export function kategoriEnrollment(status: unknown): StatusSaya {
	const s = String(status ?? '').trim().toLowerCase();
	if (s === 'lulus') return 'lulus';
	if (s === 'enrolled' || s === 'ongoing' || s === 'remedial') return 'berjalan';
	return 'belum';
}

const RANK: Record<StatusSaya, number> = { lulus: 2, berjalan: 1, belum: 0 };
export const bestOf = (a: StatusSaya, b: StatusSaya): StatusSaya => (RANK[b] > RANK[a] ? b : a);
