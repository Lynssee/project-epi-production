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
	it('fallback linear target estimasi harian bila Kurva S belum memiliki tanggal spesifik', () => {
		const projLinear = {
			start_date: '2026-10-01',
			end_date: '2026-10-10', // 10 hari
			timeline_planning: {
				categories: [
					{
						unit: 'm²',
						subtasks: [
							{ id: 'sub_a', volume: 100 } // 100 / 10 = 10 m²/hari
						]
					}
				]
			}
		};
		const r = computeDailyTarget(projLinear, '2026-10-05', [{ subtask_id: 'sub_a', progress_value: 8 }]);
		expect(r).toEqual([
			{ unit: 'm²', target: 10, realisasi: 8, pct: 80, isEstimated: true }
		]);
	});
});
