import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));

import { susunProgress } from './fleetApprovalProgress';

describe('susunProgress', () => {
	it('total = tahap tertinggi, label tahap sekarang, terurut', () => {
		const p = susunProgress(2, [
			{ order: 3, label: 'HR MANAGER' },
			{ order: 1, label: 'MANAGER' },
			{ order: 2, label: 'GENERAL MANAGER' }
		])!;
		expect(p.total_steps).toBe(3);
		expect(p.current_step).toBe(2);
		expect(p.step_label).toBe('GENERAL MANAGER');
		expect(p.steps.map((s) => s.order)).toEqual([1, 2, 3]);
	});
	it('current_step kosong → 1; tahap tanpa label → null; tanpa tahap → null', () => {
		expect(susunProgress(0 as any, [{ order: 1, label: null }])?.current_step).toBe(1);
		expect(susunProgress(1, [{ order: 1, label: null }])?.step_label).toBeNull();
		expect(susunProgress(1, [])).toBeNull();
	});
});
