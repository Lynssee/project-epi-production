import { describe, it, expect } from 'vitest';
import { calculateProjectProgressPercentage } from './projectProgress';

// Paritas dengan erp-epi projectUtils.progressPercentage.test.js (Fase 2 penyelarasan progres).
describe('calculateProjectProgressPercentage (parity erp-epi, unit-aware)', () => {
	it('1 lot dengan actual besar tidak mendominasi pekerjaan m²', () => {
		const project = {
			status: 'hold',
			timeline_planning: {
				categories: [
					{
						subtasks: [
							{ volume: 1, daily_actual: { d1: 1388 } },
							{ volume: 2258, daily_actual: {} },
							{ volume: 1630, daily_actual: {} }
						]
					}
				]
			}
		};
		// Legacy sumActual/sumTarget ≈ 0,03%; hierarkis = 1 dari 3 subtask 100% = 33,33%.
		expect(calculateProjectProgressPercentage(project)).toBeCloseTo(33.33, 1);
	});

	it('subtask wajib bobot 0 dikecualikan', () => {
		const project = {
			status: 'on progress',
			timeline_planning: {
				categories: [
					{
						subtasks: [
							{ volume: 100, daily_actual: { d1: 50 } },
							{ volume: 1, wajib_key: 'mobilisasi', bobot_pct: 0, daily_actual: {} }
						]
					}
				]
			}
		};
		expect(calculateProjectProgressPercentage(project)).toBe(50);
	});

	it('tanpa timeline → total_progress (persen, bukan dibagi target_progress)', () => {
		expect(calculateProjectProgressPercentage({ status: 'on progress', total_progress: '40', target_progress: '198' })).toBe(40);
	});

	it('terminal → 100', () => {
		expect(calculateProjectProgressPercentage({ status: 'selesai' })).toBe(100);
	});
});
