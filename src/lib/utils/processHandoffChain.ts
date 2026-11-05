// src/lib/utils/processHandoffChain.ts
// Rantai Serah-Terima sebuah alur (lapangan): "Diterima dari (Hulu)" & "Diserahkan ke (Hilir)". MURNI — dites.
// Sumber panah: (1) konfigurasi Peta Grand di erp-epi (app_settings process_guidance/grand_map_config, atau bawaan bila belum dikustomisasi)
// dan (2) node.handoffs[] di tiap alur. Panah yang sama dari dua sumber digabung (teks dari alur menang, kode dari konfigurasi dipertahankan).
// Panah internal satu alur (mis. antar-lane) tidak ditampilkan di sini; panah yang ujungnya tak terbit disembunyikan, bukan error.
import type { ProcessFlow, ProcessHandoff } from '$lib/data/processGuidance';

export type HandoffType = ProcessHandoff['handoff_type'];

export interface ConfigHandoff {
	code: string;
	from_flow: string;
	from_node: string;
	to_flow: string;
	to_node: string;
	handoff_type: HandoffType;
	doc_label: string;
}

/** Satu ujung rantai relatif terhadap alur yang sedang dibuka. */
export interface ChainItem {
	code: string;
	doc_label: string;
	handoff_type: HandoffType;
	/** Langkah di alur INI yang terlibat (asal untuk hilir, tujuan untuk hulu). */
	own_node_id: string;
	own_node_label: string;
	/** Alur di seberang. */
	flow_id: string;
	flow_title: string;
	node_id: string;
	node_label: string;
}
export interface FlowChain {
	upstream: ChainItem[];
	downstream: ChainItem[];
}

export const HANDOFF_TYPE_LABEL: Record<HandoffType, string> = { dokumen: 'Dokumen', barang: 'Barang', dana: 'Dana', otorisasi: 'Otorisasi' };
const TYPES = Object.keys(HANDOFF_TYPE_LABEL);
const KEY_RE = /^[a-z0-9_]{1,100}$/;
const NODE_RE = /^[a-z0-9_]{1,60}$/;
const s = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Isi app_settings.setting_value (teks/objek) → daftar handoff bersih; null = tidak ada daftar tersimpan (pakai bawaan). Tak pernah melempar. */
export function parseHandoffConfig(raw: unknown): ConfigHandoff[] | null {
	let v: any = raw;
	if (typeof v === 'string') {
		if (!v.trim()) return null;
		try {
			v = JSON.parse(v);
		} catch {
			return null;
		}
	}
	if (!v || typeof v !== 'object' || !Array.isArray(v.handoffs)) return null;
	const out: ConfigHandoff[] = [];
	for (const h of v.handoffs.slice(0, 300)) {
		const from_flow = s(h?.from_flow, 100);
		const to_flow = s(h?.to_flow, 100);
		const from_node = s(h?.from_node, 60);
		const to_node = s(h?.to_node, 60);
		const type = s(h?.handoff_type, 20) || 'dokumen';
		if (!KEY_RE.test(from_flow) || !KEY_RE.test(to_flow) || (from_node && !NODE_RE.test(from_node)) || (to_node && !NODE_RE.test(to_node)) || !TYPES.includes(type)) continue;
		out.push({ code: s(h?.code, 12), from_flow, from_node, to_flow, to_node, handoff_type: type as HandoffType, doc_label: s(h?.doc_label, 120) });
	}
	return out;
}

/**
 * @param flowId alur yang dibuka
 * @param flows semua alur terbit (definisi lengkap)
 * @param config daftar handoff konfigurasi (tersimpan atau bawaan)
 */
export function buildChain(flowId: string, flows: ProcessFlow[], config: ConfigHandoff[]): FlowChain {
	const byId = new Map(flows.map((f) => [f.id, f]));
	const key = (e: ConfigHandoff) => `${e.from_flow}:${e.from_node}>${e.to_flow}:${e.to_node}`;
	const edges = new Map<string, ConfigHandoff>();
	for (const h of config) edges.set(key(h), h);
	for (const f of flows) {
		for (const n of f.nodes) {
			for (const h of n.handoffs ?? []) {
				const e: ConfigHandoff = { code: '', from_flow: f.id, from_node: n.id, to_flow: h.target_flow_key, to_node: h.target_node_id, handoff_type: h.handoff_type, doc_label: h.doc_label };
				const prev = edges.get(key(e));
				edges.set(key(e), prev ? { ...prev, handoff_type: e.handoff_type, doc_label: e.doc_label || prev.doc_label } : e);
			}
		}
	}

	const label = (flow: ProcessFlow | undefined, nodeId: string): string => (nodeId ? flow?.nodes.find((n) => n.id === nodeId)?.label ?? '' : '');
	const upstream: ChainItem[] = [];
	const downstream: ChainItem[] = [];
	for (const e of edges.values()) {
		if (e.from_flow === e.to_flow) continue;
		const from = byId.get(e.from_flow);
		const to = byId.get(e.to_flow);
		if (!from || !to) continue;
		if (e.from_node && !from.nodes.some((n) => n.id === e.from_node)) continue;
		if (e.to_node && !to.nodes.some((n) => n.id === e.to_node)) continue;
		const base = { code: e.code, doc_label: e.doc_label, handoff_type: e.handoff_type };
		if (e.from_flow === flowId) {
			downstream.push({ ...base, own_node_id: e.from_node, own_node_label: label(from, e.from_node), flow_id: to.id, flow_title: to.title, node_id: e.to_node, node_label: label(to, e.to_node) });
		} else if (e.to_flow === flowId) {
			upstream.push({ ...base, own_node_id: e.to_node, own_node_label: label(to, e.to_node), flow_id: from.id, flow_title: from.title, node_id: e.from_node, node_label: label(from, e.from_node) });
		}
	}
	return { upstream, downstream };
}

/** Bentuk muatan dari server aman dipakai? (klien memeriksa sebelum memercayai salinan tersimpan) */
export function validChain(v: unknown): v is FlowChain {
	const ok = (a: unknown) => Array.isArray(a) && a.every((i) => i && typeof i.flow_id === 'string' && typeof i.flow_title === 'string' && typeof i.doc_label === 'string');
	return !!v && typeof v === 'object' && ok((v as FlowChain).upstream) && ok((v as FlowChain).downstream);
}
