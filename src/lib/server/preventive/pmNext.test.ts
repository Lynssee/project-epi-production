import { describe, it, expect } from 'vitest';
import { addMonthsClamped, nextDueDate } from './pmNext';

describe('pmNext (harus identik dengan erp-epi pmBulanan.js)', () => {
	it('klem akhir bulan & lintas tahun', () => {
		expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
		expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
		expect(addMonthsClamped('2026-12-15', 1)).toBe('2027-01-15');
		expect(addMonthsClamped('x', 1)).toBeNull();
	});
	it('satuan Bulan/Hari/Tahun; Jam/KM dan nilai tak valid → null', () => {
		expect(nextDueDate('2026-11-20', 1, 'Bulan')).toBe('2026-12-20');
		expect(nextDueDate('2026-11-20', 10, 'Hari')).toBe('2026-11-30');
		expect(nextDueDate('2026-11-20', 1, 'Tahun')).toBe('2027-11-20');
		expect(nextDueDate('2026-11-20', 250, 'Jam (HM)')).toBeNull();
		expect(nextDueDate('2026-11-20', 0, 'Bulan')).toBeNull();
	});
});
