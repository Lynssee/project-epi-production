// Gate rasionalitas qty sisi lapangan (Rencana Gate Rasionalitas Packing List, Fase 4).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveGateModeMock = vi.fn(async (..._a: any[]) => 'hard');
vi.mock('../gateDefinitionsMode', () => ({ resolveGateMode: (...a: any[]) => resolveGateModeMock(...a) }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));

const { evaluateFieldPLGates, evaluateFieldPLGatesFor } = await import('./plFieldGates');
const { loadFieldCoverage, resolveCoverageGateMode, resetFieldCoverageCache } = await import('./plFieldCoverageLoader');
const { resolvePklCoverageSettings } = await import('$lib/shared/plCoverageSettings');

const OX955 = { id: 'r1', code: 'OX-955', name: 'Foxafloor SLW', unit: 'kg', default_consumption: 0.6 };
const settings = resolvePklCoverageSettings([]);
const mkCov = (over: any = {}) => ({
	settings,
	rates: [OX955],
	area: { areaM2: 10, source: 'charter' },
	dailyRate: null,
	priorByRateId: new Map(),
	siteStockByRateId: new Map(),
	fillById: new Map([['15', 20]]),
	...over
});
const row = (qty: number, over: any = {}) => ({
	id: 1,
	project_id: 10,
	qty,
	unit: 'Pail',
	identitas_barang_id: 15,
	material_name: 'FOXAFLOOR SLW : OX-955 GREY',
	material_color: 'Grey',
	budget_category: 'supplier',
	...over
});
const base = (rows: any[], modes: any, cov: any) => ({
	rows,
	projectStatusById: new Map([['10', 'on progress']]),
	stockById: new Map<string, number>(),
	modes,
	coverageByProject: new Map([['10', cov]])
});
const gate = (r: any, key: string) => r.gates.find((g: any) => g.gate_key === key);

describe('evaluateFieldPLGates — rasionalitas qty (G_PKL_COVERAGE_M2)', () => {
	it('10 Pail pada 10 m², mode hard ⇒ memblokir dengan saran maks 1', () => {
		const r = evaluateFieldPLGates(base([row(10)], { G_PKL_COVERAGE_M2: 'hard' }, mkCov()));
		expect(r.blocking).toContain('G_PKL_COVERAGE_M2');
		expect(gate(r, 'G_PKL_COVERAGE_M2').message).toContain('wajar maks 1 Pail');
		expect(gate(r, 'G_PKL_COVERAGE_M2').affected_items).toEqual([{ id: 1, label: 'FOXAFLOOR SLW : OX-955 GREY' }]);
	});
	it('mode hard + override super admin/GM ⇒ tidak memblokir, ditandai overridden', () => {
		const r = evaluateFieldPLGates(base([row(10)], { G_PKL_COVERAGE_M2: 'hard' }, mkCov()), { overrideAllowed: true });
		expect(r.blocking).not.toContain('G_PKL_COVERAGE_M2');
		expect(r.overridden).toContain('G_PKL_COVERAGE_M2');
	});
	it('mode soft ⇒ peringatan, tetap bisa dikirim', () => {
		const r = evaluateFieldPLGates(base([row(10)], { G_PKL_COVERAGE_M2: 'soft' }, mkCov()));
		expect(r.blocking).not.toContain('G_PKL_COVERAGE_M2');
		expect(r.warnings).toContain('G_PKL_COVERAGE_M2');
		expect(gate(r, 'G_PKL_COVERAGE_M2').message).toContain('tetap bisa dikirim');
	});
	it('mode shadow ⇒ tidak tampil, hanya tercatat di shadowed', () => {
		const r = evaluateFieldPLGates(base([row(10)], { G_PKL_COVERAGE_M2: 'shadow' }, mkCov()));
		expect(gate(r, 'G_PKL_COVERAGE_M2')).toBeUndefined();
		expect(r.shadowed).toContain('G_PKL_COVERAGE_M2');
		expect(r.blocking).toEqual([]);
	});
	it('mode tak dipasok ⇒ fallback shadow (gate baru tak pernah lahir hard di kode)', () => {
		const r = evaluateFieldPLGates(base([row(10)], {}, mkCov()));
		expect(r.blocking).toEqual([]);
		expect(r.warnings).toEqual([]);
	});
	it('qty wajar ⇒ passed (mode non-shadow); luasan kosong / tanpa konteks ⇒ tidak dievaluasi', () => {
		const ok = evaluateFieldPLGates(base([row(1)], { G_PKL_COVERAGE_M2: 'hard' }, mkCov()));
		expect(gate(ok, 'G_PKL_COVERAGE_M2').status).toBe('passed');
		const noArea = evaluateFieldPLGates(base([row(10)], { G_PKL_COVERAGE_M2: 'hard' }, mkCov({ area: null })));
		expect(noArea.blocking).toEqual([]);
		expect(gate(noArea, 'G_PKL_COVERAGE_M2')).toBeUndefined();
		const none = evaluateFieldPLGates({ rows: [row(10)], projectStatusById: new Map([['10', 'on progress']]), stockById: new Map(), modes: { G_PKL_COVERAGE_M2: 'hard' } });
		expect(gate(none, 'G_PKL_COVERAGE_M2')).toBeUndefined();
	});
	it('baris non-barang (no_item_needed / manpower) diabaikan', () => {
		const r = evaluateFieldPLGates(base([row(10, { no_item_needed: true }), row(10, { id: 2, is_manpower: true })], { G_PKL_COVERAGE_M2: 'hard' }, mkCov()));
		expect(r.blocking).toEqual([]);
	});
});

describe('evaluateFieldPLGates — run-rate & stok site', () => {
	it('5 Pail > kebutuhan 7 hari (400 m², 20 m²/hari ⇒ 92.4 kg) ⇒ G_PKL_TIMELINE_RUNRATE gagal', () => {
		const cov = mkCov({ area: { areaM2: 400, source: 'proyek' }, dailyRate: { rate: 20, source: 'timeline' } });
		const r = evaluateFieldPLGates(base([row(5)], { G_PKL_TIMELINE_RUNRATE: 'hard' }, cov));
		expect(r.blocking).toContain('G_PKL_TIMELINE_RUNRATE');
		expect(gate(r, 'G_PKL_TIMELINE_RUNRATE').message).toContain('maks 4 Pail');
	});
	it('barang sudah di site > 3 hari tanpa pemakaian ⇒ G_PKL_SITE_STOCK_RECON menahan', () => {
		const cov = mkCov({ siteStockByRateId: new Map([['r1', { onHandStd: 20, receivedStd: 20, usedStd: 0, lastMovement: '2020-01-01' }]]) });
		const r = evaluateFieldPLGates(base([row(1)], { G_PKL_SITE_STOCK_RECON: 'soft' }, cov));
		expect(r.warnings).toContain('G_PKL_SITE_STOCK_RECON');
		expect(gate(r, 'G_PKL_SITE_STOCK_RECON').message).toContain('belum ada pemakaian dilaporkan');
	});
});

describe('evaluateFieldPLGatesFor — hemat API & fail-open', () => {
	const dx = vi.fn(async (path: string) => (path.includes('/items/projects?') ? { data: [{ id: 10, status: 'on progress' }] } : { data: [] }));
	beforeEach(() => {
		dx.mockClear();
	});

	it('semua gate rasionalitas shadow ⇒ konteks TIDAK dimuat', async () => {
		const loadCoverage = vi.fn();
		await evaluateFieldPLGatesFor([row(10)], dx, { resolveMode: async () => 'shadow', loadCoverage } as any);
		expect(loadCoverage).not.toHaveBeenCalled();
	});
	it('salah satu non-shadow ⇒ dimuat sekali per proyek aktif; gagal muat ⇒ fail-open (tidak memblokir)', async () => {
		const loadCoverage = vi.fn(async () => mkCov());
		const r = await evaluateFieldPLGatesFor([row(10)], dx, {
			resolveMode: async (k: string) => (k === 'G_PKL_COVERAGE_M2' ? 'hard' : 'shadow'),
			loadCoverage
		} as any);
		expect(loadCoverage).toHaveBeenCalledTimes(1);
		expect(r.blocking).toContain('G_PKL_COVERAGE_M2');
		const bad = await evaluateFieldPLGatesFor([row(10)], dx, {
			resolveMode: async (k: string) => (k === 'G_PKL_COVERAGE_M2' ? 'hard' : 'shadow'),
			loadCoverage: async () => { throw new Error('boom'); }
		} as any);
		expect(bad.blocking).not.toContain('G_PKL_COVERAGE_M2');
	});
	it('proyek tak aktif ⇒ konteks tidak dimuat (sudah ditolak G_PKL_PROJECT)', async () => {
		const loadCoverage = vi.fn();
		const dxClosed = vi.fn(async (p: string) => (p.includes('/items/projects?') ? { data: [{ id: 10, status: 'closed' }] } : { data: [] }));
		await evaluateFieldPLGatesFor([row(10)], dxClosed, { resolveMode: async () => 'hard', loadCoverage } as any);
		expect(loadCoverage).not.toHaveBeenCalled();
	});
});

describe('loadFieldCoverage & resolveCoverageGateMode', () => {
	beforeEach(() => {
		resetFieldCoverageCache();
		resolveGateModeMock.mockClear();
	});
	const timeline = { categories: [{ unit: 'm2', subtasks: [{ id: 1, unit: 'm²', daily_plan: { '2099-01-01': 20 } }] }] };
	const mkDx = (map: Array<[string, any]>) => vi.fn(async (path: string) => {
		for (const [frag, resp] of map) if (path.includes(frag)) {
			if (resp instanceof Error) throw resp;
			return resp;
		}
		return { data: [] };
	});

	it('gate belum di-seed di gate_definitions ⇒ shadow (bukan fallback soft bawaan); sudah di-seed ⇒ ikut resolveGateMode', async () => {
		const none = mkDx([['/items/gate_definitions', { data: [] }]]);
		expect(await resolveCoverageGateMode('G_PKL_COVERAGE_M2', none)).toBe('shadow');
		expect(resolveGateModeMock).not.toHaveBeenCalled();
		resetFieldCoverageCache();
		const seeded = mkDx([['/items/gate_definitions', { data: [{ id: 1 }] }]]);
		expect(await resolveCoverageGateMode('G_PKL_COVERAGE_M2', seeded)).toBe('hard');
		expect(resolveGateModeMock).toHaveBeenCalledWith('G_PKL_COVERAGE_M2', 'PL');
	});

	it('memuat luasan (charter sampah "1" dilewati → proyek), laju timeline, kumulatif PL lain, stok site; tanpa query bersarang', async () => {
		const dx = mkDx([
			['/items/app_settings', { data: [] }],
			['fields=id,max_consumption', { data: [{ id: 'r1', max_consumption: 2.21 }] }],
			['/items/kalkulator_material_rate', { data: [OX955] }],
			['/items/projects/', { data: { id: 10, total_area_m2: 500, timeline_planning: timeline } }],
			['/items/project_charters', { data: [{ id: 1, nilai_luasan: '1' }] }],
			['/items/packing_list?', { data: [{ id: 50 }] }],
			['/items/packing_list_items', { data: [{ id: 9, item_id: 15, nama_barang: 'FOXAFLOOR SLW : OX-955 GREY', qty_required: 2, unit: 'Pail' }] }],
			['/items/project_stock_balance', { data: [{ item_id: 15, qty_on_hand: 1, qty_received: 1, qty_used: 0, last_movement_date: '2026-10-01' }] }],
			['/items/identitas_barang', { data: [{ id: 15, nama_barang_lengkap: 'FOXAFLOOR SLW : OX-955 GREY', satuan: 'Pail', fill_weight_kg: 16 }] }]
		]);
		const c = await loadFieldCoverage(10, [15], dx);
		expect(c.area).toEqual({ areaM2: 500, source: 'proyek' });
		expect(c.rates[0].max_consumption).toBe(2.21);
		expect(c.fillById.get('15')).toBe(16);
		expect(c.priorByRateId.get('r1')).toEqual({ base: 32, unit: 'kg' });
		expect(c.siteStockByRateId.get('r1')).toMatchObject({ onHandStd: 16, usedStd: 0, lastMovement: '2026-10-01' });
		expect(dx.mock.calls.every(([u]) => !/fields=[^&]*\w\.\w/.test(String(u)))).toBe(true);
	});

	it('Directus gagal ⇒ tidak melempar; luasan null', async () => {
		const dx = mkDx([
			['/items/app_settings', new Error('x')],
			['/items/kalkulator_material_rate', new Error('x')],
			['/items/projects/', new Error('x')],
			['/items/project_charters', new Error('x')],
			['/items/packing_list?', new Error('x')],
			['/items/project_stock_balance', new Error('x')]
		]);
		const c = await loadFieldCoverage(10, [15], dx);
		expect(c.area).toBeNull();
		expect(c.rates).toEqual([]);
	});
});
