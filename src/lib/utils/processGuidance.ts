// src/lib/utils/processGuidance.ts
// Pengelompokan alur per lane untuk tampilan mobile (akordeon) — murni, tanpa DOM, bisa dites.
import type { ProcessFlow, ProcessNode } from '$lib/data/processGuidance';

export interface NextStep {
	toId: string;
	toLabel: string;
	/** Kondisi pada panah ("ditolak", "PO Cat", …); kosong = langkah berikutnya biasa. */
	condition: string;
	/** true bila kembali ke langkah sebelumnya (loop). */
	backward: boolean;
}

export interface NodeView extends ProcessNode {
	next: NextStep[];
}

export interface LaneSection {
	key: string;
	label: string;
	nodes: NodeView[];
}

/** Lane kosong dibuang; node diurut kolom lalu baris; `next` dari edge (target tak dikenal dilewati). */
export function buildLaneSections(flow: ProcessFlow | null | undefined): LaneSection[] {
	if (!flow) return [];
	const nodes = flow.nodes || [];
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const views = nodes.map<NodeView>((n) => ({
		...n,
		next: (flow.edges || [])
			.filter((e) => e.from === n.id && byId.has(e.to))
			.map((e) => {
				const t = byId.get(e.to)!;
				return { toId: t.id, toLabel: t.label, condition: e.label || '', backward: t.col < n.col };
			})
	}));
	return (flow.lanes || [])
		.map((l) => ({
			key: l.key,
			label: l.label,
			nodes: views
				.filter((v) => v.lane === l.key)
				.sort((a, b) => a.col - b.col || (a.row ?? 0) - (b.row ?? 0))
		}))
		.filter((s) => s.nodes.length > 0);
}

/** Lane yang memuat node `id` (untuk membuka akordeon saat deep-link ?fokus=). */
export function laneOfNode(flow: ProcessFlow | null | undefined, id: string): string | null {
	return flow?.nodes?.find((n) => n.id === id)?.lane ?? null;
}
