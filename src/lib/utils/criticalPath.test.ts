import { describe, it, expect, vi } from 'vitest';
import { computeCriticalPath } from './criticalPath';

const plan = (start: string, days: number) => {
	const o: Record<string, number> = {};
	const d = new Date(start + 'T00:00:00');
	for (let i = 0; i < days; i++) {
		o[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`] = 1;
		d.setDate(d.getDate() + 1);
	}
	return o;
};
const opts = { workdaysPerWeek: 7, holidaySet: new Set<string>() };

describe('computeCriticalPath (port lapangan)', () => {
	it('rantai A→B→C kritis; cabang pendek D (A→D) punya float; subtask lepas tidak kritis', () => {
		const cats = [
			{
				subtasks: [
					{ id: 'A', daily_plan: plan('2026-03-01', 3) },
					{ id: 'B', predecessorId: 'A', daily_plan: plan('2026-03-04', 5) },
					{ id: 'C', predecessorId: 'B', daily_plan: plan('2026-03-09', 2) },
					{ id: 'D', predecessorId: 'A', daily_plan: plan('2026-03-04', 1) },
					{ id: 'X', daily_plan: plan('2026-03-01', 4) }
				]
			}
		];
		const r = computeCriticalPath(cats, opts);
		expect(r.get('A')!.critical).toBe(true);
		expect(r.get('B')!.critical).toBe(true);
		expect(r.get('C')!.critical).toBe(true);
		expect(r.get('D')!.critical).toBe(false);
		expect(r.get('D')!.float).toBe(6);
		expect(r.get('X')!.critical).toBe(false);
	});

	it('siklus predecessor tidak crash dan tidak kritis', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const cats = [{ subtasks: [{ id: 'P', predecessorId: 'Q', daily_plan: plan('2026-03-01', 1) }, { id: 'Q', predecessorId: 'P', daily_plan: plan('2026-03-02', 1) }] }];
		const r = computeCriticalPath(cats, opts);
		expect(r.get('P')!.critical).toBe(false);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it('input kosong/aneh aman', () => {
		expect(computeCriticalPath([] as any).size).toBe(0);
		expect(() => computeCriticalPath([{ subtasks: [{ name: 'tanpa id' }] }] as any)).not.toThrow();
	});
});
