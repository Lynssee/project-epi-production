import { describe, it, expect } from 'vitest';
import { sjReadiness } from './sjReadiness';

describe('sjReadiness (SJH-18)', () => {
	it('belum dicetak → hint admin logistik', () => {
		const r = sjReadiness({ approval_status: 'tidak_perlu', print_count: 0 }, true);
		expect(r.next_hint).toMatch(/mencetak/);
		expect(r.steps.find((s) => s.key === 'disetujui')?.done).toBe(true);
	});
	it('dicetak, belum dimuat → gudang; dimuat belum lolos → satpam', () => {
		expect(sjReadiness({ print_count: 1 }, true).next_hint).toMatch(/gudang/);
		expect(sjReadiness({ print_count: 1, track_stage: 'dimuat' }, true).next_hint).toMatch(/satpam/);
	});
	it('kategori tanpa satpam → langkah gerbang disembunyikan; semua selesai → null', () => {
		const r = sjReadiness({ print_count: 1, track_stage: 'dimuat' }, false);
		expect(r.steps.some((s) => s.key === 'gerbang')).toBe(false);
		expect(r.next_hint).toBeNull();
	});
	it('shipped dianggap lolos & dimuat', () => {
		expect(sjReadiness({ print_count: 1, status: 'shipped' }, true).next_hint).toBeNull();
	});
});
