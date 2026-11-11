import { describe, it, expect } from 'vitest';
import {
	parseCutoffTime,
	formatIsoDate,
	getIsoWeekday,
	computePaBatchCycle,
	getCutoffCountdown
} from './paCutoffCycle';

describe('paCutoffCycle (project-epi)', () => {
	it('parseCutoffTime parsing jam dan default fallback', () => {
		expect(parseCutoffTime('17:00')).toEqual({ hours: 17, minutes: 0 });
		expect(parseCutoffTime('14:30')).toEqual({ hours: 14, minutes: 30 });
		expect(parseCutoffTime(null)).toEqual({ hours: 17, minutes: 0 });
	});

	it('getIsoWeekday mengonversi hari dengan benar (1=Senin..7=Minggu)', () => {
		// 2026-11-09 = Senin (1)
		expect(getIsoWeekday(new Date('2026-11-09T10:00:00Z'))).toBe(1);
		// 2026-11-15 = Minggu (7)
		expect(getIsoWeekday(new Date('2026-11-15T10:00:00Z'))).toBe(7);
	});

	it('sebelum cutoff Rabu 17:00 -> batch rilis Jumat minggu berjalan (W0)', () => {
		const cycle = computePaBatchCycle(new Date('2026-11-11T10:00:00+07:00')); // Rabu 10:00 WIB
		expect(cycle.isPostCutoff).toBe(false);
		expect(cycle.batchCode).toBe('W0');
		expect(cycle.batchRilisTarget).toBe('2026-11-13');
	});

	it('setelah cutoff Rabu 17:00 -> batch rilis Jumat pekan depan (W+1)', () => {
		const cycle = computePaBatchCycle(new Date('2026-11-11T18:00:00+07:00')); // Rabu 18:00 WIB
		expect(cycle.isPostCutoff).toBe(true);
		expect(cycle.batchCode).toBe('W+1');
		expect(cycle.batchRilisTarget).toBe('2026-11-20');
	});

	it('setelah cutoff dengan opsi darurat valid -> fast track ke Jumat minggu ini (W0)', () => {
		const cycle = computePaBatchCycle(new Date('2026-11-12T09:00:00+07:00'), {
			isEmergency: true,
			emergencyReason: 'Kerusakan pompa submersible air darurat proyek'
		});
		expect(cycle.isPostCutoff).toBe(true);
		expect(cycle.isEmergencyFastTrack).toBe(true);
		expect(cycle.batchCode).toBe('W0');
		expect(cycle.batchRilisTarget).toBe('2026-11-13');
	});

	it('countdown kalkulasi sisa waktu dan waktu lewat', () => {
		const cutoff = new Date('2026-11-11T17:00:00+07:00');
		const currentBefore = new Date('2026-11-10T12:00:00+07:00');
		const resBefore = getCutoffCountdown(cutoff, currentBefore);
		expect(resBefore.isPassed).toBe(false);
		expect(resBefore.days).toBe(1);
		expect(resBefore.hours).toBe(5);
		expect(resBefore.countdownText).toContain('1 hari 5 jam');

		const currentAfter = new Date('2026-11-11T18:00:00+07:00');
		const resAfter = getCutoffCountdown(cutoff, currentAfter);
		expect(resAfter.isPassed).toBe(true);
		expect(resAfter.countdownText).toBe('Batas cutoff telah lewat');
	});
});
