// src/lib/services/wbsApi.ts
// Fase 7 (Revamp Project Management v2, 3 Agustus 2026): sinkron WBS ke lapangan — READ + update
// completion_pct node daun saja (bukan CRUD penuh; struktur/bobot tetap diedit di Admin ERP,
// konsisten prinsip "Rekomendasi Luar Cerita" dokumen: 1-tap update completion_pct paling berharga
// untuk lapangan, bukan pengelolaan struktur WBS penuh).
// Port dari erp-epi-1/src/lib/services/wbsApi.js — reimplementasi (dua repo tak berbagi lib),
// logic rollup completion_pct disamakan.

import directus, { handleDirectusError } from './directus';
import { readItems, updateItem } from '@directus/sdk';

export interface WbsNode {
	id: number;
	project_id: number;
	parent_id: number | null;
	name: string;
	weight_pct: number;
	status: string;
	completion_pct: number;
	level: number;
	sort_order: number;
	children?: WbsNode[];
}

export async function fetchWbsTree(projectId: string | number): Promise<{ roots: WbsNode[]; flat: WbsNode[] }> {
	try {
		const flat = (await directus.request(
			readItems('proj_wbs' as any, {
				filter: { project_id: { _eq: projectId } } as any,
				sort: ['sort_order'],
				limit: -1
			})
		)) as WbsNode[];

		const byId = new Map<number, WbsNode>(flat.map((n) => [n.id, { ...n, children: [] }]));
		const roots: WbsNode[] = [];
		for (const node of byId.values()) {
			if (node.parent_id && byId.has(node.parent_id)) {
				byId.get(node.parent_id)!.children!.push(node);
			} else {
				roots.push(node);
			}
		}
		return { roots, flat };
	} catch (error) {
		handleDirectusError(error);
		return { roots: [], flat: [] };
	}
}

function rollupCompletion(node: WbsNode): number {
	if (!node.children || node.children.length === 0) return node.completion_pct || 0;
	for (const child of node.children) child.completion_pct = rollupCompletion(child);
	const totalWeight = node.children.reduce((s, c) => s + (c.weight_pct || 0), 0);
	if (totalWeight <= 0) return 0;
	const weighted = node.children.reduce((s, c) => s + (c.weight_pct || 0) * (c.completion_pct || 0), 0);
	return Math.round((weighted / totalWeight) * 10) / 10;
}

/**
 * Update completion_pct satu node daun, lalu hitung ulang & simpan turunan seluruh leluhurnya.
 * Hanya untuk node TANPA anak (leaf) — validasi di pemanggil (UI tidak menampilkan input untuk node ber-anak).
 */
export async function updateLeafCompletion(projectId: string | number, nodeId: number, pct: number): Promise<void> {
	try {
		const clamped = Math.min(100, Math.max(0, pct));
		await directus.request(
			updateItem('proj_wbs' as any, nodeId, {
				completion_pct: clamped,
				status: clamped >= 100 ? 'selesai' : clamped > 0 ? 'berjalan' : 'belum_mulai'
			} as any)
		);

		const { roots } = await fetchWbsTree(projectId);
		const updates: Array<{ id: number; completion_pct: number }> = [];
		function walk(node: WbsNode) {
			if (node.children && node.children.length > 0) {
				const newVal = rollupCompletion(node);
				if (newVal !== node.completion_pct) updates.push({ id: node.id, completion_pct: newVal });
			}
			(node.children || []).forEach(walk);
		}
		roots.forEach(walk);

		for (const u of updates) {
			await directus.request(updateItem('proj_wbs' as any, u.id, { completion_pct: u.completion_pct } as any));
		}
	} catch (error) {
		handleDirectusError(error);
		throw error;
	}
}
