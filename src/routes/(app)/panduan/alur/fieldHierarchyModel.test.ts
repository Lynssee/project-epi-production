// src/routes/(app)/panduan/alur/fieldHierarchyModel.test.ts
import { describe, it, expect } from 'vitest';
import type { FlowSummary } from '$lib/utils/processMyTasks';
import { buildFieldHierarchyView } from './fieldHierarchyModel';

const FLOWS: FlowSummary[] = [
	{
		id: 'inventory_stock_opname',
		title: 'Alur Stock Opname',
		description: 'Master',
		version: 1,
		node_count: 5,
		row_id: 12,
		kategori_sop: 'master',
		sop_code: 'SOP-LOG-002',
		approval_status: 'published'
	},
	{
		id: 'opname_bulanan',
		title: 'Stock Opname Bulanan',
		description: 'Induk',
		version: 1,
		node_count: 4,
		row_id: 749,
		parent_row_id: 12,
		kategori_sop: 'induk',
		sop_code: 'SOP-PRJ-320',
		approval_status: 'published'
	},
	{
		id: 'ik_blind_count',
		title: 'IK Blind Count Lapangan',
		description: 'IK 1',
		version: 1,
		node_count: 3,
		row_id: 904,
		parent_row_id: 749,
		kategori_sop: 'turunan',
		sop_code: 'IK-LOG-001',
		approval_status: 'draft'
	},
	{
		id: 'ik_selisih',
		title: 'IK Investigasi Selisih',
		description: 'IK 2',
		version: 1,
		node_count: 2,
		row_id: 905,
		parent_row_id: 749,
		kategori_sop: 'turunan',
		sop_code: 'IK-LOG-002',
		approval_status: 'published'
	}
];

describe('buildFieldHierarchyView', () => {
	it('membangun keterangan Master -> Induk -> Anak Kerja (IK) termasuk status draft approval', () => {
		const view = buildFieldHierarchyView('inventory_stock_opname', FLOWS);
		expect(view.roleKey).toBe('master');
		expect(view.statement).toContain('Ini adalah MASTER SOP');
		expect(view.statement).toContain('1 SOP INDUK');
		expect(view.statement).toContain('2 ANAK KERJA / IK');
		expect(view.counts).toEqual({
			totalDescendants: 3,
			indukCount: 1,
			turunanCount: 2,
			draftApprovalCount: 1,
			skippedDraftCount: 0
		});
		expect(view.indukGroups).toHaveLength(1);
		expect(view.indukGroups[0].induk.sop_code).toBe('SOP-PRJ-320');
		expect(view.indukGroups[0].anakKerja.map((a) => a.sop_code)).toEqual(['IK-LOG-001', 'IK-LOG-002']);
		expect(view.indukGroups[0].anakKerja[0].is_draft_approval).toBe(true);
	});

	it('menampilkan keterangan eksplisit Induk lengkap dengan rujukan Master dan anak langsungnya', () => {
		const view = buildFieldHierarchyView('opname_bulanan', FLOWS);
		expect(view.roleKey).toBe('induk');
		expect(view.statement).toContain('Ini adalah SOP INDUK');
		expect(view.statement).toContain('[SOP-LOG-002]');
		expect(view.directTurunan.map((t) => t.id)).toEqual(['ik_blind_count', 'ik_selisih']);
	});

	it('menampilkan silsilah atas untuk IK dan menghormati filter includeDraftApproval=false', () => {
		const view = buildFieldHierarchyView('ik_blind_count', FLOWS);
		expect(view.roleKey).toBe('turunan');
		expect(view.statement).toContain('[SOP-PRJ-320]');
		expect(view.statement).toContain('Master: [SOP-LOG-002]');
		expect(view.ancestors.map((a) => a.id)).toEqual(['inventory_stock_opname', 'opname_bulanan']);

		const filtered = buildFieldHierarchyView('inventory_stock_opname', FLOWS, {
			includeDraftApproval: false,
			labels: { master: 'PAYUNG UTAMA' }
		});
		expect(filtered.roleLabel).toBe('PAYUNG UTAMA');
		expect(filtered.counts.turunanCount).toBe(1);
		expect(filtered.counts.skippedDraftCount).toBe(1);
	});
});
