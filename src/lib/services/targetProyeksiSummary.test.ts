import { describe, it, expect } from 'vitest';
import { currentMonthLabelWib, hitungStatus } from './targetProyeksiSummary';

describe('targetProyeksiSummary', () => {
	it('label bulan memakai WIB (UTC+7): 31 Okt 20:00 UTC sudah Nov di WIB', () => {
		expect(currentMonthLabelWib(Date.UTC(2026, 9, 31, 20, 0, 0))).toBe('2026-11');
		expect(currentMonthLabelWib(Date.UTC(2026, 10, 18, 3, 0, 0))).toBe('2026-11');
	});
	it('status gap: di jalur / berisiko / kritis / tidak diketahui', () => {
		expect(hitungStatus(80, 85).status).toBe('on_track');
		expect(hitungStatus(100, 85)).toEqual({ status: 'at_risk', gapPct: -15 });
		expect(hitungStatus(100, 50).status).toBe('off_track');
		expect(hitungStatus(null, 50).status).toBe('unknown');
		expect(hitungStatus(0, 50).status).toBe('unknown');
	});
});
