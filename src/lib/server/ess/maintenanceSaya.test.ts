import { describe, it, expect } from 'vitest';
import { hitungPmP2h } from './maintenanceSaya';

describe('hitungPmP2h', () => {
	it('PM selesai/tepat dan P2H sesi/hari/No-Go', () => {
		const pm = [
			{ due_date: '2026-11-10', last_done_date: '2026-11-09' },
			{ due_date: '2026-11-10', last_done_date: '2026-11-12' },
			{ due_date: '2026-11-20', last_done_date: null }
		];
		const p2h = [
			{ date: '2026-11-02', overall_result: 'go' },
			{ date: '2026-11-02', overall_result: 'nogo' },
			{ date: '2026-11-03', overall_result: 'nogo' }
		];
		expect(hitungPmP2h(pm, p2h, 'nogo')).toEqual({ pmSelesai: 2, pmTepat: 1, pmTepatPct: 50, p2hSesi: 3, p2hHari: 2, p2hNoGo: 2 });
	});
	it('tanpa PM selesai → persen null (bukan 0); id No-Go tak ada → 0 No-Go', () => {
		const r = hitungPmP2h([], [{ date: '2026-11-02', overall_result: 'x' }], null);
		expect(r.pmTepatPct).toBeNull();
		expect(r.p2hNoGo).toBe(0);
		expect(r.p2hSesi).toBe(1);
	});
});
