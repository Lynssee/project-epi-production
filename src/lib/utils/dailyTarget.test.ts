import { describe, it, expect } from 'vitest';
import { computeDailyTarget } from './dailyTarget';

const project = {
	timeline_planning: {
		categories: [
			{
				unit: 'm²',
				subtasks: [
					{ id: 's1', daily_plan: { '2026-10-10': 25, '2026-10-11': 30 } },
					{ id: 's2', daily_plan: { '2026-10-10': 5 } },
					{ id: 'mob', unit: 'ls', daily_plan: { '2026-10-09': 1 } }
				]
			}
		]
	}
};

describe('computeDailyTarget', () => {
	it('menjumlah target hari ini per satuan dan membandingkan dengan input form', () => {
		const r = computeDailyTarget(project, '2026-10-10', [{ subtask_id: 's1', progress_value: '20' }]);
		expect(r).toEqual([{ unit: 'm²', target: 30, realisasi: 20, pct: 67 }]);
	});
	it('tanpa rencana hari ini → kosong (kartu disembunyikan)', () => {
		expect(computeDailyTarget(project, '2026-10-20', [])).toEqual([]);
	});
	it('pct dibatasi 100 dan item tanpa subtask_id diabaikan', () => {
		const r = computeDailyTarget(project, '2026-10-10', [
			{ subtask_id: 's1', progress_value: 99 },
			{ progress_value: 50 }
		]);
		expect(r[0].pct).toBe(100);
		expect(r[0].realisasi).toBe(99);
	});
	it('project null aman', () => {
		expect(computeDailyTarget(null, '2026-10-10', [])).toEqual([]);
	});
});
