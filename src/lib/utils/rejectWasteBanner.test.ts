import { describe, it, expect } from 'vitest';
import { computeRejectWasteBanner } from './rejectWasteBanner';

describe('computeRejectWasteBanner', () => {
	it('tanpa reject/waste atau total 0 → tidak ada banner', () => {
		expect(computeRejectWasteBanner({ outputKg: 100, rejectKg: '', wasteKg: '' }).level).toBe('none');
		expect(computeRejectWasteBanner({ outputKg: 0, rejectKg: 0, wasteKg: 0 }).level).toBe('none');
		expect(computeRejectWasteBanner({ outputKg: null, rejectKg: undefined, wasteKg: 'abc' }).level).toBe('none');
	});
	it('di bawah ambang default (2% / 1,5%) → tidak ada banner', () => {
		expect(computeRejectWasteBanner({ outputKg: 970, rejectKg: 15, wasteKg: 10 }).level).toBe('none');
	});
	it('melebihi ambang → warn dengan pesan reject & waste', () => {
		const b = computeRejectWasteBanner({ outputKg: 900, rejectKg: 60, wasteKg: 40 });
		expect(b.level).toBe('warn');
		expect(b.rejectOver && b.wasteOver).toBe(true);
		expect(b.messages).toHaveLength(2);
		expect(b.messages[0]).toMatch(/6%/);
	});
	it('ambang dari setelan; ambang tak valid kembali ke default', () => {
		expect(computeRejectWasteBanner({ outputKg: 900, rejectKg: 60, wasteKg: 0, rejectMaxPct: 10 }).level).toBe('none');
		expect(computeRejectWasteBanner({ outputKg: 900, rejectKg: 60, wasteKg: 0, rejectMaxPct: 'x' }).level).toBe('warn');
	});
	it('nilai negatif diabaikan (tidak crash)', () => {
		expect(computeRejectWasteBanner({ outputKg: 100, rejectKg: -5, wasteKg: -1 }).level).toBe('none');
	});
});
