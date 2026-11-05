// src/lib/utils/processGuidanceFlowRow.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeFlowRow, inferProcedureType } from './processGuidanceFlowRow';
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
	it('pintasan = actions_field (bukan actions admin); gates disertakan read-only; versi & metadata terbawa', () => {
		const r = normalizeFlowRow(base(def()))!;
		const n1 = r.flow.nodes[0];
		expect(n1.actions).toEqual([{ label: 'Lapangan', href: '/sales/po' }]);
		expect(n1.gates).toEqual([{ key: 'G_A', modul: 'm', documentType: 'd' }]);
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

describe('normalizeFlowRow — field integrasi jobdesc/KPI (cermin erp-epi)', () => {
	const row = (node: any) => ({
		flow_key: 'k', title: 'T',
		definition: { lanes: [{ key: 'a', label: 'A' }], nodes: [{ id: 'n1', type: 'task', lane: 'a', col: 0, label: 'L', ...node }], edges: [] }
	});
	it('meneruskan posisi_ids/sla_hours/kpi_code yang valid', () => {
		const n = normalizeFlowRow(row({ posisi_ids: [30, '30', 58, 'x'], sla_hours: 4.256, kpi_code: ' K1 ' }))!.flow.nodes[0];
		expect(n).toMatchObject({ posisi_ids: [30, 58], sla_hours: 4.26, kpi_code: 'K1' });
	});
	it('nilai rusak dibuang; node lama tidak mendapat kunci baru', () => {
		const n = normalizeFlowRow(row({ posisi_ids: 'x', sla_hours: -1, kpi_code: 5 }))!.flow.nodes[0];
		expect('posisi_ids' in n || 'sla_hours' in n || 'kpi_code' in n).toBe(false);
	});
});

describe('normalizeFlowRow — tautan training (T5, cermin erp-epi)', () => {
	const row = (def: any) => ({ flow_key: 'k', title: 'T', definition: { lanes: [{ key: 'a', label: 'A' }], nodes: [{ id: 'n1', type: 'task', lane: 'a', col: 0, label: 'L', training_ids: [13, '13', 14, 'x', 15, 16] }], edges: [], ...def } });
	it('meneruskan training (alur) & training_ids (langkah, maks. 3); entri rusak/dobel dibuang; wajib boolean', () => {
		const f = normalizeFlowRow(row({ training: [{ program_id: '13', wajib: 'true', catatan: ' K3 ' }, { program_id: 13 }, { program_id: 'x' }, { program_id: 18, wajib: 0 }, null] }))!.flow;
		expect(f.training).toEqual([{ program_id: 13, wajib: true, catatan: 'K3' }, { program_id: 18, wajib: false }]);
		expect(f.nodes[0].training_ids).toEqual([13, 14, 15]);
	});
	it('tanpa tautan → tidak ada kunci baru; maksimal 5 tautan alur', () => {
		const f = normalizeFlowRow(row({}))!.flow;
		expect('training' in f).toBe(false);
		const many = normalizeFlowRow(row({ training: [1, 2, 3, 4, 5, 6, 7].map((program_id) => ({ program_id })) }))!.flow;
		expect(many.training).toHaveLength(5);
	});
});

describe('normalizeFlowRow & inferProcedureType — klasifikasi sifat prosedur (Fase 4)', () => {
	it('meneruskan procedure_type eksplisit yang valid', () => {
		const r = normalizeFlowRow(base(def(), { procedure_type: 'field_ops' }))!;
		expect(r.flow.procedure_type).toBe('field_ops');
	});

	it('menginferensi field_ops untuk alur inspeksi/coating/spark tester lapangan', () => {
		expect(inferProcedureType({ title: 'Inspeksi & Tes Holiday Detector Spark Tester', flow_key: 'field_holiday' })).toBe('field_ops');
		expect(inferProcedureType({ title: 'Pemeriksaan Visual Blasting & Painting', flow_key: 'coating_blasting' })).toBe('field_ops');
	});

	it('menginferensi emergency_qhse untuk alur tanggap darurat & insiden', () => {
		expect(inferProcedureType({ title: 'Prosedur Evakuasi dan Tanggap Darurat Kebakaran', flow_key: 'hse_emergency' })).toBe('emergency_qhse');
	});

	it('menginferensi management_gate untuk alur evaluasi & approval RAP', () => {
		expect(inferProcedureType({ title: 'Evaluasi & Approval RAP Direksi', flow_key: 'approval_rap' })).toBe('management_gate');
	});

	it('menginferensi administrative untuk alur payroll & faktur invoice kantor', () => {
		expect(inferProcedureType({ title: 'Penerbitan Invoice & Faktur Pajak', flow_key: 'invoice_ar' })).toBe('administrative');
	});

	it('membawa id baris Directus & id induk (untuk breadcrumb); nilai tak valid dibuang', () => {
		const r = normalizeFlowRow(base(def(), { id: 7, parent_flow_id: 3 }))!;
		expect(r.flow.row_id).toBe(7);
		expect(r.flow.parent_row_id).toBe(3);
		const t = normalizeFlowRow(base(def(), { id: 7, parent_flow_id: null }))!;
		expect(t.flow.parent_row_id).toBeUndefined();
		const x = normalizeFlowRow(base(def(), { id: 'abc', parent_flow_id: -2 }))!;
		expect(x.flow.row_id).toBeUndefined();
		expect(x.flow.parent_row_id).toBeUndefined();
	});
});
