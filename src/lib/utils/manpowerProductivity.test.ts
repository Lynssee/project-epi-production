// src/lib/utils/manpowerProductivity.test.ts
import { describe, it, expect } from 'vitest';
import { computeDailyProductivity, isAreaUnit, extractVolume } from './manpowerProductivity';

describe('manpowerProductivity in project-epi', () => {
	it('harus memvalidasi unit luas', () => {
		expect(isAreaUnit('m2')).toBe(true);
		expect(isAreaUnit('M²')).toBe(true);
		expect(isAreaUnit('kg')).toBe(false);
	});

	it('harus mengekstrak volume dengan benar', () => {
		expect(extractVolume({ progress_value: 50 })).toBe(50);
		expect(extractVolume({ stages: { pekerjaan: 85 } })).toBe(85);
	});

	it('harus menghitung output harian dan memberikan status peringatan/normal', () => {
		const progress = [
			{ activity: 'Sandblasting Sa 2.5', progress_value: 40, unit: 'm2' },
			{ activity: 'Topcoat Painting', progress_value: 160, unit: 'm2' }
		];
		const manpower = [
			{ role: 'BLASTER', count: 2 },
			{ role: 'PAINTER', count: 2 },
			{ role: 'HELPER', count: 1 }
		];

		const res = computeDailyProductivity(progress, manpower);
		expect(res.volumeBlastingM2).toBe(40);
		expect(res.volumePaintingM2).toBe(160);
		expect(res.blasterOutputM2PerDay).toBe(20);
		expect(res.painterOutputM2PerDay).toBe(80);
		expect(res.blasterRatioPct).toBe(100);
		expect(res.painterRatioPct).toBe(100);
		expect(res.statusTone).toBe('ok');
	});

	it('harus memberikan alert jika ada volume tanpa tenaga kerja teknis', () => {
		const progress = [{ activity: 'Blasting Tangki', progress_value: 50, unit: 'm2' }];
		const manpower = [{ role: 'HELPER', count: 2 }];

		const res = computeDailyProductivity(progress, manpower);
		expect(res.statusTone).toBe('err');
		expect(res.hint).toContain('tanpa personil teknis');
	});
});
