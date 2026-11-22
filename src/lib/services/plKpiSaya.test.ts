import { describe, it, expect, vi } from 'vitest';
vi.mock('./directus', () => ({ default: { request: vi.fn() }, handleDirectusError: vi.fn() }));
vi.mock('./plDashboard', () => ({ getLedProjects: vi.fn(), getActiveEquipmentIds: vi.fn(), getPlKpi: vi.fn() }));
import { healthTone, p2hPct, perhatianProyek } from './plKpiSaya';

const kpi = (o: any = {}) => ({ woOpen: 0, woInspection: 0, woTotal: 0, p2hDone: 0, p2hEquipmentCount: 0, pmOverdue: 0, pmTotal: 0, ...o });

describe('plKpiSaya', () => {
	it('healthTone', () => {
		expect(healthTone(90)).toBe('on_target');
		expect(healthTone(85)).toBe('on_target');
		expect(healthTone(70)).toBe('warning');
		expect(healthTone(40)).toBe('critical');
		expect(healthTone(null)).toBe('no_data');
		expect(healthTone(undefined)).toBe('no_data');
	});
	it('p2hPct', () => {
		expect(p2hPct(kpi({ p2hDone: 2, p2hEquipmentCount: 4 }))).toBe(50);
		expect(p2hPct(kpi())).toBeNull();
		expect(p2hPct(null)).toBeNull();
	});
	it('perhatianProyek', () => {
		expect(perhatianProyek({ healthScore: 50, kpi: kpi({ pmOverdue: 2, p2hDone: 1, p2hEquipmentCount: 2 }) })).toEqual([
			'Health Score kritis (50)', '2 jadwal PM terlambat', 'P2H hari ini baru 50%'
		]);
		expect(perhatianProyek({ healthScore: 90, kpi: null })).toEqual([]);
	});
});
