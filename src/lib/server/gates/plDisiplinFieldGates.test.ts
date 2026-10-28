// Gate disiplin PL sisi lapangan: logika murni, mode, dan penggabungan ke hasil gate.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../gateDefinitionsMode', () => ({ resolveGateMode: vi.fn(async () => 'shadow') }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));

import {
	checkEquipmentP2h,
	checkLaporanHarian,
	computeRequiredReportDates,
	evaluateDisiplinForProject,
	mergeDisiplinIntoResult,
	type DisiplinInfo
} from './plDisiplinFieldGates';
import type { FieldPLResult } from './plFieldGates';

const base = (): FieldPLResult => ({ gates: [], status: 'passed', blocking: [], warnings: [], overridden: [], override_allowed: false });
const info = (over: Partial<DisiplinInfo>): DisiplinInfo => ({
	gate_key: 'G_PKL_LAPORAN_HARIAN', label: 'x', mode: 'shadow', status: 'failed', message: 'bolong', project_id: 1, fix_links: [], ...over
});

describe('pure checks (paritas dengan admin)', () => {
	it('P2H: tanpa equipment aktif -> N/A; ada yang belum -> failed + daftar unit', () => {
		expect(checkEquipmentP2h({ today: '2026-10-13', equipment: [], doneIds: [] }).status).toBe('not_applicable');
		const r = checkEquipmentP2h({ today: '2026-10-13', equipment: [{ id: 'a', label: 'CMP-007' }, { id: 'b', label: 'GEN-1' }], doneIds: ['b'] });
		expect(r.status).toBe('failed');
		expect(r.message).toContain('1 dari 2');
		expect(r.missing?.map((m) => m.id)).toEqual(['a']);
	});
	it('Laporan: N/A bila tak applicable; failed menyebut tanggal DD/MM/YYYY', () => {
		expect(checkLaporanHarian({ required: [], reported: [], applicable: false, naReason: 'proyek belum mulai (mobilisasi awal)' }).status).toBe('not_applicable');
		const r = checkLaporanHarian({ required: ['2026-10-10', '2026-10-12'], reported: ['2026-10-10'], applicable: true });
		expect(r.status).toBe('failed');
		expect(r.message).toContain('12/10/2026');
	});
	it('computeRequiredReportDates: Minggu dilewati, dibatasi start_date', () => {
		expect(computeRequiredReportDates({ todayYmd: '2026-10-13', hariWajib: [1, 2, 3, 4, 5, 6], windowHari: 3 })).toEqual(['2026-10-09', '2026-10-10', '2026-10-12']);
		expect(computeRequiredReportDates({ todayYmd: '2026-10-13', hariWajib: [1, 2, 3, 4, 5, 6], windowHari: 7, startDate: '2026-10-10' })).toEqual(['2026-10-10', '2026-10-12']);
	});
});

describe('mergeDisiplinIntoResult — mode', () => {
	it('shadow: tidak mengubah gates/warnings/blocking', () => {
		const r = mergeDisiplinIntoResult(base(), [info({ mode: 'shadow' })]);
		expect(r.gates).toEqual([]);
		expect(r.status).toBe('passed');
		expect(r.disiplin).toHaveLength(1);
	});
	it('soft & warn: peringatan, tidak memblokir', () => {
		for (const mode of ['soft', 'warn'] as const) {
			const r = mergeDisiplinIntoResult(base(), [info({ mode })]);
			expect(r.blocking).toEqual([]);
			expect(r.warnings).toEqual(['G_PKL_LAPORAN_HARIAN']);
			expect(r.status).toBe('soft_warning');
		}
	});
	it('hard: memblokir (WAJIB) untuk pengaju biasa', () => {
		const r = mergeDisiplinIntoResult(base(), [info({ mode: 'hard' })]);
		expect(r.blocking).toEqual(['G_PKL_LAPORAN_HARIAN']);
		expect(r.gates[0].severity).toBe('WAJIB');
		expect(r.status).toBe('blocked');
	});
	it('hard + override (super admin/GM): tidak memblokir, ditandai overridden', () => {
		const r = mergeDisiplinIntoResult(base(), [info({ mode: 'hard' })], { overrideAllowed: true });
		expect(r.blocking).toEqual([]);
		expect(r.overridden).toEqual(['G_PKL_LAPORAN_HARIAN']);
	});
	it('N/A tidak pernah memblokir walau mode hard (D2)', () => {
		const r = mergeDisiplinIntoResult(base(), [info({ mode: 'hard', status: 'not_applicable' })]);
		expect(r.blocking).toEqual([]);
		expect(r.gates[0].status).toBe('not_applicable');
	});
	it('lintas proyek: satu entri per gate, pesan memuat id proyek', () => {
		const r = mergeDisiplinIntoResult(base(), [info({ mode: 'warn', project_id: 1 }), info({ mode: 'warn', project_id: 2, status: 'passed', message: 'ok' })]);
		expect(r.gates).toHaveLength(1);
		expect(r.gates[0].message).toContain('Proyek #1');
	});
});

describe('evaluateDisiplinForProject — semua pengaju, fail-open', () => {
	it('tidak membedakan pengaju; gagal baca Directus -> N/A, tidak melempar', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const dx = vi.fn(async () => { throw new Error('HTTP 500'); });
		const r = await evaluateDisiplinForProject(7, dx, async () => 'hard');
		expect(r.map((x) => x.status)).toEqual(['not_applicable', 'not_applicable', 'not_applicable']);
		expect(spy).toHaveBeenCalled();
	});
	it('proyek berstatus tidak wajib lapor -> laporan N/A; equipment aktif belum P2H -> failed', async () => {
		const dx = vi.fn(async (path: string) => {
			if (path.startsWith('/items/laporan_compliance_rule')) return { data: {} };
			if (path.startsWith('/items/projects/')) return { data: { id: 7, status: 'hold', start_date: '2026-01-01' } };
			if (path.startsWith('/items/project_equipment')) return { data: [{ id: 1, equipment_id: 'e1' }] };
			if (path.startsWith('/items/equipment')) return { data: [{ id: 'e1', code: 'CMP-007', name: 'Compressor' }] };
			if (path.startsWith('/items/p2h_session')) return { data: [] };
			return { data: [] };
		});
		const r = await evaluateDisiplinForProject(7, dx, async () => 'warn');
		expect(r.find((x) => x.gate_key === 'G_PKL_LAPORAN_HARIAN')?.status).toBe('not_applicable');
		const p = r.find((x) => x.gate_key === 'G_PKL_EQUIPMENT_P2H')!;
		expect(p.status).toBe('failed');
		expect(p.fix_links[0].href).toBe('/preventive/p2h/e1');
	});
});

describe('G_PKL_READINESS (kembar erp-epi plReadinessGate)', () => {
	const settings = (extra: Record<string, any> = {}) =>
		Object.entries({ 'project.kickoff.enforce_from': '2026-10-13', ...extra }).map(([setting_key, v]) => ({ setting_key, setting_value: JSON.stringify(v) }));
	const charterOk = { id: 1, status: 'approved', project_leader: 'PL', timeline_planning: { subtasks: [{ id: 1 }] } };

	function makeDx(o: { project?: any; charter?: any; rab?: number; settings?: any[] } = {}) {
		const project = o.project ?? { id: 7, so_customer_id: 3, leader: 'PL', date_created: '2026-10-14T00:00:00Z', end_date: null, lokasi: null, jenis_project: null, timeline_planning: null };
		return vi.fn(async (path: string) => {
			if (path.startsWith('/items/system_settings')) return { data: o.settings ?? settings() };
			if (path.startsWith('/items/projects/')) return { data: project };
			if (path.startsWith('/items/project_charters')) return { data: o.charter === null ? [] : [o.charter ?? charterOk] };
			if (path.startsWith('/items/project_budgets')) return { data: [{ planned_amount: o.rab ?? 1000 }] };
			return { data: [] };
		});
	}

	it('data dasar kosong → failed + tautan perbaikan ke /proyek/:id', async () => {
		const r = await evaluateDisiplinForProject(7, makeDx(), async () => 'hard');
		const g = r.find((x) => x.gate_key === 'G_PKL_READINESS')!;
		expect(g.status).toBe('failed');
		expect(g.mode).toBe('hard');
		expect(g.message).toContain('Foto proyek');
		expect(g.fix_links[0].href).toBe('/proyek/7');
	});
	it('proyek sebelum enforce_from → N/A (Aturan #3)', async () => {
		const g = (await evaluateDisiplinForProject(7, makeDx({ project: { id: 7, so_customer_id: 3, date_created: '2026-10-01T00:00:00Z' } }), async () => 'hard')).find((x) => x.gate_key === 'G_PKL_READINESS')!;
		expect(g.status).toBe('not_applicable');
	});
	it('tanpa Charter → N/A', async () => {
		const g = (await evaluateDisiplinForProject(7, makeDx({ charter: null }), async () => 'hard')).find((x) => x.gate_key === 'G_PKL_READINESS')!;
		expect(g.status).toBe('not_applicable');
	});
	it('lengkap → passed; gate_extra_items kosong → hanya item dasar lama', async () => {
		const full = { id: 7, so_customer_id: 3, leader: 'PL', date_created: '2026-10-14T00:00:00Z', end_date: '2026-12-01', lokasi: 'X', jenis_project: 'coating', timeline_planning: { metadata: { thumbnail_file_id: 'f' } } };
		expect((await evaluateDisiplinForProject(7, makeDx({ project: full }), async () => 'hard')).find((x) => x.gate_key === 'G_PKL_READINESS')!.status).toBe('passed');
		const g = (await evaluateDisiplinForProject(7, makeDx({ settings: settings({ 'project.readiness.gate_extra_items': [] }) }), async () => 'hard')).find((x) => x.gate_key === 'G_PKL_READINESS')!;
		expect(g.status).toBe('passed');
	});
	it('mode hard + gagal → memblokir; override GM → dilewati', () => {
		const info: any = [{ gate_key: 'G_PKL_READINESS', label: 'Kesiapan data proyek', mode: 'hard', status: 'failed', message: 'x', project_id: 7, fix_links: [] }];
		const base: any = { gates: [], status: 'passed', blocking: [], warnings: [], overridden: [], override_allowed: false };
		expect(mergeDisiplinIntoResult(base, info).blocking).toEqual(['G_PKL_READINESS']);
		expect(mergeDisiplinIntoResult(base, info, { overrideAllowed: true }).overridden).toEqual(['G_PKL_READINESS']);
	});
});
