// src/lib/utils/processGuidanceFlowRow.ts
// Normalisasi baris `process_guidance_flows` (Directus, DIKELOLA dari erp-epi /settings/process-guidance) → ProcessFlow versi LAPANGAN.
// Beda dengan erp-epi: pintasan diambil dari `actions_field` (route project-epi), `gates` TIDAK dibawa (pengaturan gate hanya di admin).
// Defensif: data rusak dibuang, tidak boleh membuat layar putih. Cermin processGuidanceFlowRow.js di erp-epi.
import type { ProcessAction, ProcessFlow, ProcessNode, ProcessNodeType } from '$lib/data/processGuidance';

const NODE_TYPES = new Set<string>(['start', 'task', 'decision', 'end']);

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown, def = 0): number => (v !== null && v !== '' && v !== undefined && Number.isInteger(Number(v)) ? Number(v) : def);
const strList = (v: unknown, maxItems: number, maxLen: number): string[] =>
	Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];

/** Pintasan hanya path internal ("/…", bukan "//host" atau skema lain). */
function cleanActions(v: unknown): ProcessAction[] {
	if (!Array.isArray(v)) return [];
	return v
		.map((a: any) => ({ label: str(a?.label, 80), href: str(a?.href, 300) }))
		.filter((a) => a.label && /^\/(?!\/)[^\s]*$/.test(a.href))
		.slice(0, 8);
}

export interface NormalizedFlow {
	flow: ProcessFlow & { version: number };
	dropped: string[];
}

export function normalizeFlowRow(row: any): NormalizedFlow | null {
	const flowKey = str(row?.flow_key, 100);
	let def: any = row?.definition;
	if (typeof def === 'string') {
		try {
			def = JSON.parse(def);
		} catch {
			def = null;
		}
	}
	if (!flowKey || !def || typeof def !== 'object' || !Array.isArray(def.nodes) || !Array.isArray(def.lanes)) return null;

	const dropped: string[] = [];
	const lanes: { key: string; label: string }[] = [];
	const laneKeys = new Set<string>();
	for (const l of def.lanes) {
		const key = str(l?.key, 60);
		if (!key || laneKeys.has(key)) {
			dropped.push(`lane ${l?.key ?? '(kosong)'}`);
			continue;
		}
		laneKeys.add(key);
		lanes.push({ key, label: str(l?.label, 60) || key.toUpperCase() });
	}

	const nodes: ProcessNode[] = [];
	const ids = new Set<string>();
	for (const n of def.nodes) {
		const id = str(n?.id, 60);
		if (!id || ids.has(id) || !laneKeys.has(n?.lane)) {
			dropped.push(`node ${n?.id ?? '(kosong)'}`);
			continue;
		}
		ids.add(id);
		nodes.push({
			id,
			type: (NODE_TYPES.has(n.type) ? n.type : 'task') as ProcessNodeType,
			lane: n.lane,
			col: Math.max(0, int(n.col)),
			row: Math.max(0, int(n.row)),
			label: str(n.label, 80) || id,
			desc: str(n.desc, 2000),
			pic: str(n.pic, 200),
			checklist: strList(n.checklist, 20, 300),
			blockers: strList(n.blockers, 20, 300),
			actions: cleanActions(n.actions_field) // lapangan: HANYA pintasan lapangan, tanpa gates
		});
	}

	const edges: { from: string; to: string; label?: string }[] = [];
	for (const e of Array.isArray(def.edges) ? def.edges : []) {
		const from = str(e?.from, 60);
		const to = str(e?.to, 60);
		if (!ids.has(from) || !ids.has(to)) {
			dropped.push(`edge ${e?.from}->${e?.to}`);
			continue;
		}
		const label = typeof e.label === 'string' ? e.label.slice(0, 60) : '';
		edges.push(label ? { from, to, label } : { from, to });
	}

	return {
		flow: {
			id: flowKey,
			title: str(row.title, 120) || flowKey,
			description: str(row.description, 1000),
			lanes,
			nodes,
			edges,
			version: int(row.version, 1)
		},
		dropped
	};
}
