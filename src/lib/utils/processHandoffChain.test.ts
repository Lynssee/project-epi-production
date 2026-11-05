import { describe, it, expect } from 'vitest';
import { buildChain, parseHandoffConfig, validChain, type ConfigHandoff } from './processHandoffChain';
import { DEFAULT_HANDOFFS } from '$lib/data/processHandoffDefaults';
import { normalizeFlowRow } from './processGuidanceFlowRow';

const flow = (id: string, nodes: Array<string | { id: string; label?: string; handoffs?: any[] }>): any => ({
	id, title: `Alur ${id}`, description: '', lanes: [{ key: 'l', label: 'L' }], edges: [], version: 1,
	nodes: nodes.map((n) => (typeof n === 'string' ? { id: n, label: `L-${n}` } : { label: `L-${n.id}`, ...n })).map((n) => ({ type: 'task', lane: 'l', col: 0, desc: '', ...n }))
});
const cfg = (o: Partial<ConfigHandoff>): ConfigHandoff => ({ code: 'H1', from_flow: 'a', from_node: 'a1', to_flow: 'b', to_node: 'b1', handoff_type: 'dokumen', doc_label: 'Dok', ...o });
const FLOWS = [flow('a', ['a1', 'a2']), flow('b', ['b1', 'b2']), flow('c', ['c1'])];

describe('buildChain', () => {
	it('hilir = panah keluar alur ini; hulu = panah masuk; label langkah & judul alur seberang terisi', () => {
		const ch = buildChain('a', FLOWS, [cfg({})]);
		expect(ch.upstream).toEqual([]);
		expect(ch.downstream).toEqual([{ code: 'H1', doc_label: 'Dok', handoff_type: 'dokumen', own_node_id: 'a1', own_node_label: 'L-a1', flow_id: 'b', flow_title: 'Alur b', node_id: 'b1', node_label: 'L-b1' }]);
		const rev = buildChain('b', FLOWS, [cfg({})]);
		expect(rev.upstream[0]).toMatchObject({ own_node_id: 'b1', flow_id: 'a', node_id: 'a1', node_label: 'L-a1' });
		expect(rev.downstream).toEqual([]);
	});
	it('alur tak terlibat → rantai kosong; panah internal satu alur & panah putus (alur/langkah tak ada) disembunyikan', () => {
		const c = buildChain('c', FLOWS, [cfg({})]);
		expect(c).toEqual({ upstream: [], downstream: [] });
		const a = buildChain('a', FLOWS, [cfg({ to_flow: 'a', to_node: 'a2' }), cfg({ code: 'H2', to_flow: 'zzz' }), cfg({ code: 'H3', to_node: 'tidak_ada' }), cfg({ code: 'H4', from_node: 'x' })]);
		expect(a.downstream).toEqual([]);
	});
	it('node.handoffs di alur ikut menjadi panah; sama dengan konfigurasi → digabung (kode dipertahankan, teks alur menang)', () => {
		const fl = [flow('a', [{ id: 'a1', handoffs: [{ target_flow_key: 'b', target_node_id: 'b1', doc_label: 'Dari alur', handoff_type: 'barang' }, { target_flow_key: 'c', target_node_id: '', doc_label: 'Ke C', handoff_type: 'dana' }] }]), flow('b', ['b1']), flow('c', ['c1'])];
		const ch = buildChain('a', fl, [cfg({})]);
		expect(ch.downstream).toHaveLength(2);
		expect(ch.downstream[0]).toMatchObject({ code: 'H1', doc_label: 'Dari alur', handoff_type: 'barang' });
		expect(ch.downstream[1]).toMatchObject({ code: '', flow_id: 'c', node_id: '', node_label: '' });
	});
	it('tanpa konfigurasi & tanpa handoff → kosong; 28 bawaan: sales_to_inventory punya hulu & hilir bila alur lengkap', () => {
		expect(buildChain('a', FLOWS, [])).toEqual({ upstream: [], downstream: [] });
		const ids = new Map<string, Set<string>>();
		for (const h of DEFAULT_HANDOFFS) for (const [f, n] of [[h.from_flow, h.from_node], [h.to_flow, h.to_node]]) ids.set(f, (ids.get(f) ?? new Set()).add(n));
		const fl = [...ids].map(([id, ns]) => flow(id, [...ns]));
		const ch = buildChain('project_field_execution', fl, DEFAULT_HANDOFFS);
		expect(ch.upstream.map((u) => u.code).sort()).toEqual(['H02', 'H11', 'H15', 'H18', 'H22']);
		expect(ch.downstream.map((d) => d.code).sort()).toEqual(['H14', 'H16', 'H19']);
	});
});

describe('bawaan & parse', () => {
	it('28 bawaan: kode H01..H28 unik, jenis valid', () => {
		expect(DEFAULT_HANDOFFS).toHaveLength(28);
		expect(new Set(DEFAULT_HANDOFFS.map((h) => h.code)).size).toBe(28);
		expect(DEFAULT_HANDOFFS.every((h) => ['dokumen', 'barang', 'dana', 'otorisasi'].includes(h.handoff_type))).toBe(true);
	});
	it('parseHandoffConfig: teks/objek; tanpa daftar → null (pakai bawaan); entri rusak dibuang; handoffs [] → daftar kosong', () => {
		const good = { code: 'X', from_flow: 'a', from_node: 'n', to_flow: 'b', to_node: '', handoff_type: 'dana', doc_label: 'D' };
		expect(parseHandoffConfig(JSON.stringify({ handoffs: [good, { ...good, from_flow: 'Bad Key' }, { ...good, handoff_type: 'kapal' }] }))).toEqual([good]);
		expect(parseHandoffConfig({ handoffs: [] })).toEqual([]);
		for (const v of [null, '', '{rusak', '[]', { phases: [] }, 5]) expect(parseHandoffConfig(v)).toBeNull();
	});
	it('validChain menolak bentuk rusak', () => {
		expect(validChain({ upstream: [], downstream: [] })).toBe(true);
		for (const v of [null, {}, { upstream: 1, downstream: [] }, { upstream: [{}], downstream: [] }]) expect(validChain(v)).toBe(false);
	});
});

describe('normalizeFlowRow — handoffs terbawa', () => {
	const row = (handoffs: any) => ({ flow_key: 'f1', title: 'F1', definition: { lanes: [{ key: 'l', label: 'L' }], nodes: [{ id: 'n1', type: 'start', lane: 'l', col: 0, label: 'M', handoffs }], edges: [] } });
	it('valid terbawa; kunci/jenis salah dibuang; maks. 8', () => {
		const ok = { target_flow_key: 'b', target_node_id: 'x', doc_label: 'D', handoff_type: 'dokumen' };
		const n = normalizeFlowRow(row([ok, { ...ok, target_flow_key: 'Bad Key' }, { ...ok, handoff_type: 'x' }]))!;
		expect(n.flow.nodes[0].handoffs).toEqual([ok]);
		expect(normalizeFlowRow(row(Array.from({ length: 12 }, () => ok)))!.flow.nodes[0].handoffs).toHaveLength(8);
		expect(normalizeFlowRow(row(undefined))!.flow.nodes[0]).not.toHaveProperty('handoffs');
	});
});
