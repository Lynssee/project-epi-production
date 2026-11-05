// src/lib/utils/processMyTasks.test.ts
import { describe, it, expect } from 'vitest';
import { extractMyTasks, summarizeFlow } from './processMyTasks';
import { buildPosisiIndex } from './processPicResolver';
import type { ProcessFlow } from '$lib/data/processGuidance';

const index = buildPosisiIndex([{ id: 30, nama_posisi: 'PROJECT LEADER' }, { id: 58, nama_posisi: 'PROJECT MANAGER' }], { 'Admin Gudang': 68 });
const idx2 = buildPosisiIndex([{ id: 30, nama_posisi: 'PROJECT LEADER' }, { id: 68, nama_posisi: 'ADMIN INVENTORY' }], { 'Admin Gudang': 68 });

const flow = (id: string, nodes: any[]): ProcessFlow & { version: number } =>
	({ id, title: `Alur ${id}`, description: 'desc', lanes: [{ key: 'a', label: 'ADMIN' }], nodes, edges: [], version: 3 }) as any;
const n = (id: string, over: any = {}) => ({ id, type: 'task', lane: 'a', col: 0, label: `L-${id}`, desc: '', ...over });

describe('extractMyTasks', () => {
	const flows = [
		flow('f1', [
			n('s', { type: 'start', pic: 'Project Leader', sla_hours: 4, kpi_code: 'k1', gates: [{ key: 'G1', modul: 'm', documentType: 'd' }], actions: [{ label: 'Form', href: '/x' }] }),
			n('t', { pic: 'Admin Gudang' }),
			n('e', { type: 'end', pic: 'Project Leader' }),
			n('l', { pic: 'Project Leader Lapangan' })
		]),
		flow('f2', [n('m', { pic: 'apa saja', posisi_ids: [30] })])
	];
	it('hanya kecocokan pasti; node end dilewati; saran tidak dihitung', () => {
		const t = extractMyTasks(flows, idx2, 30);
		expect(t.map((x) => `${x.flow_id}:${x.node_id}`)).toEqual(['f1:s', 'f2:m']);
	});
	it('memuat label lane, SLA, KPI, gate, dan penanda pintasan', () => {
		const t = extractMyTasks(flows, idx2, 30)[0];
		expect(t).toMatchObject({ flow_title: 'Alur f1', lane_label: 'ADMIN', sla_hours: 4, kpi_code: 'k1', gate_keys: ['G1'], has_actions: true, type: 'start' });
		expect(extractMyTasks(flows, idx2, 30)[1]).toMatchObject({ sla_hours: null, kpi_code: '', gate_keys: [], has_actions: false });
	});
	it('alias dipakai; jabatan lain tak mendapat tugas orang lain', () => {
		expect(extractMyTasks(flows, idx2, 68).map((x) => x.node_id)).toEqual(['t']);
		expect(extractMyTasks(flows, idx2, 999)).toEqual([]);
	});
	it('posisiId kosong/masukan rusak → kosong tanpa crash', () => {
		expect(extractMyTasks(flows, index, null)).toEqual([]);
		expect(extractMyTasks(null as any, index, 30)).toEqual([]);
		expect(extractMyTasks([{ id: 'x' } as any, null as any], index, 30)).toEqual([]);
	});
});

describe('summarizeFlow', () => {
	it('ringkas: tanpa definisi, deskripsi dipotong', () => {
		const f = flow('f1', [n('a'), n('b')]);
		f.description = 'x'.repeat(500);
		const s = summarizeFlow(f);
		expect(s).toEqual({ id: 'f1', title: 'Alur f1', description: 'x'.repeat(200), version: 3, node_count: 2 });
		expect('nodes' in s).toBe(false);
	});
	it('membawa row_id & parent_row_id bila ada', () => {
		const f = { ...flow('f1', [n('a')]), row_id: 9, parent_row_id: 4 };
		expect(summarizeFlow(f)).toMatchObject({ row_id: 9, parent_row_id: 4 });
	});
});

describe('extractMyTasks — training per tugas (T5)', () => {
	it('tugas membawa program yang berlaku (tautan langkah + alur) dengan penanda wajib', () => {
		const flows = [flow('f1', [n('a', { pic: 'Project Leader', training_ids: [13] })])];
		(flows[0] as any).training = [{ program_id: 18, wajib: true }];
		const t = extractMyTasks(flows, idx2, 30)[0];
		expect(t.training!.sort((x, y) => x.program_id - y.program_id)).toEqual([{ program_id: 13, wajib: false }, { program_id: 18, wajib: true }]);
	});
	it('langkah tanpa tautan → daftar training kosong', () => {
		expect(extractMyTasks([flow('f2', [n('a', { pic: 'Project Leader' })])], idx2, 30)[0].training).toEqual([]);
	});
});
