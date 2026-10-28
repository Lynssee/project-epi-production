// src/lib/utils/processGuidanceFlowRow.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeFlowRow } from './processGuidanceFlowRow';
import { PROCESS_FLOWS } from '../data/processGuidance';
import { buildLaneSections } from './processGuidance';

const base = (def: any, extra: any = {}) => ({ flow_key: 'f1', title: 'Alur', description: 'd', version: 3, definition: def, ...extra });
const def = (o: any = {}) => ({
	lanes: [{ key: 'a', label: 'A' }],
	nodes: [
		{ id: 'n1', type: 'start', lane: 'a', col: 0, label: 'Mulai', actions: [{ label: 'ADMIN', href: '/admin-only' }], actions_field: [{ label: 'Lapangan', href: '/sales/po' }], gates: [{ key: 'G_A', modul: 'm', documentType: 'd' }] },
		{ id: 'n2', type: 'end', lane: 'a', col: 1, label: 'Selesai' }
	],
	edges: [{ from: 'n1', to: 'n2' }],
	...o
});

describe('normalizeFlowRow (lapangan)', () => {
	it('pintasan = actions_field (bukan actions admin); gates tidak dibawa; versi & metadata terbawa', () => {
		const r = normalizeFlowRow(base(def()))!;
		const n1 = r.flow.nodes[0];
		expect(n1.actions).toEqual([{ label: 'Lapangan', href: '/sales/po' }]);
		expect((n1 as any).gates).toBeUndefined();
		expect(r.flow).toMatchObject({ id: 'f1', title: 'Alur', version: 3 });
		expect(r.flow.nodes[1].actions).toEqual([]); // tanpa actions_field → kosong, bukan jatuh ke actions admin
		expect(r.dropped).toEqual([]);
	});

	it('hasil bisa dipakai tampilan mobile (lane → node → langkah berikutnya)', () => {
		const s = buildLaneSections(normalizeFlowRow(base(def()))!.flow);
		expect(s[0].nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
		expect(s[0].nodes[0].next[0].toId).toBe('n2');
	});

	it('JSON string di-parse; rusak/tak layak → null tanpa crash', () => {
		expect(normalizeFlowRow(base(JSON.stringify(def())))?.flow.nodes).toHaveLength(2);
		for (const bad of [null, undefined, {}, base(null), base('{x'), base({ lanes: [], nodes: 'x' }), base(def(), { flow_key: ' ' })]) {
			expect(() => normalizeFlowRow(bad)).not.toThrow();
			expect(normalizeFlowRow(bad)).toBeNull();
		}
	});

	it('membuang lane/node/edge bermasalah dan mencatatnya', () => {
		const r = normalizeFlowRow(base(def({
			lanes: [{ key: 'a', label: 'A' }, { key: 'a', label: 'dup' }, { label: 'tanpa key' }],
			nodes: [{ id: 'n1', lane: 'a', label: 'ok' }, { id: 'n1', lane: 'a' }, { id: 'n3', lane: 'hantu' }, { lane: 'a' }],
			edges: [{ from: 'n1', to: 'x' }, { from: 'y', to: 'n1' }]
		})))!;
		expect(r.flow.nodes.map((n) => n.id)).toEqual(['n1']);
		expect(r.flow.edges).toEqual([]);
		expect(r.dropped).toHaveLength(7);
	});

	it('pintasan: hanya path internal; skema berbahaya & tautan luar dibuang', () => {
		const r = normalizeFlowRow(base(def({ nodes: [{ id: 'n1', lane: 'a', label: 'X', actions_field: [
			{ label: 'ok', href: '/proyek' }, { label: 'js', href: 'javascript:alert(1)' }, { label: 'luar', href: 'https://evil.example' },
			{ label: 'rel', href: '//evil.example' }, { label: '', href: '/a' }, { label: 's', href: '/a b' }
		] }] })))!;
		expect(r.flow.nodes[0].actions).toEqual([{ label: 'ok', href: '/proyek' }]);
	});

	it('menormalkan tipe, angka, panjang teks', () => {
		const n = normalizeFlowRow(base(def({ nodes: [{ id: 'n1', type: 'aneh', lane: 'a', col: '3', row: -2, label: '', desc: 'x'.repeat(5000), checklist: ['a', 5, '', 'b'], blockers: 'bukan array' }] })))!.flow.nodes[0];
		expect(n).toMatchObject({ type: 'task', col: 3, row: 0, label: 'n1', checklist: ['a', 'b'], blockers: [] });
		expect(n.desc).toHaveLength(2000);
	});

	it('struktur node bawaan lokal tetap kompatibel dengan hasil normalisasi (kontrak bentuk)', () => {
		const local = PROCESS_FLOWS[0];
		const rebuilt = normalizeFlowRow({ flow_key: local.id, title: local.title, description: local.description, version: 1,
			definition: { lanes: local.lanes, nodes: local.nodes.map((n) => ({ ...n, actions_field: n.actions })), edges: local.edges } })!;
		expect(rebuilt.dropped).toEqual([]);
		expect(rebuilt.flow.nodes.map((n) => n.id)).toEqual(local.nodes.map((n) => n.id));
		expect(rebuilt.flow.nodes.map((n) => n.actions)).toEqual(local.nodes.map((n) => n.actions));
	});
});
