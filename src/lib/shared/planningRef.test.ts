import { describe, it, expect } from 'vitest';
import { isPlanningDerived, plannedFirst } from './planningRef';

describe('planningRef', () => {
	it('mengenali format yang sama dengan erp-epi', () => {
		expect(isPlanningDerived({ source_planning_ref: 'charter:12:spec:7' })).toBe(true);
		expect(isPlanningDerived({ source_planning_ref: 'charter:5:manpower' })).toBe(true);
		expect(isPlanningDerived({ source_planning_ref: 'charter:5:method:sandblasting-kompresor' })).toBe(true);
	});
	it('menolak yang bukan', () => {
		expect(isPlanningDerived(null)).toBe(false);
		expect(isPlanningDerived({ source_planning_ref: '' })).toBe(false);
		expect(isPlanningDerived({ source_planning_ref: 'charter:0:spec' })).toBe(false);
		expect(isPlanningDerived({ source_planning_ref: 'foo:1:spec' })).toBe(false);
		expect(isPlanningDerived({ source_planning_ref: 'charter:1:x' })).toBe(false);
	});
	it('plannedFirst stabil', () => {
		const rows = [{ id: 1 }, { id: 2, source_planning_ref: 'charter:1:spec:1' }, { id: 3 }, { id: 4, source_planning_ref: 'charter:1:spec:2' }];
		expect(plannedFirst(rows).map((r) => r.id)).toEqual([2, 4, 1, 3]);
	});
});
