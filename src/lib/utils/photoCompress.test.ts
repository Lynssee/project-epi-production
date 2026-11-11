import { describe, it, expect } from 'vitest';
import { computeTargetSize } from './photoCompress';

describe('computeTargetSize (PMT-52)', () => {
	it('mengecilkan landscape 4000x3000 ke sisi terpanjang 1200', () => {
		expect(computeTargetSize(4000, 3000, 1200)).toEqual({ width: 1200, height: 900 });
	});
	it('mengecilkan portrait 3000x4000 ke sisi terpanjang 1200', () => {
		expect(computeTargetSize(3000, 4000, 1200)).toEqual({ width: 900, height: 1200 });
	});
	it('tidak pernah memperbesar foto yang sudah kecil', () => {
		expect(computeTargetSize(800, 600, 1200)).toEqual({ width: 800, height: 600 });
	});
	it('foto sangat lonjong tetap minimal 1 px', () => {
		const r = computeTargetSize(20000, 10, 1200);
		expect(r.width).toBe(1200);
		expect(r.height).toBeGreaterThanOrEqual(1);
	});
	it('input tidak valid -> 0x0 (caller memakai jalur lama)', () => {
		expect(computeTargetSize(0, 100, 1200)).toEqual({ width: 0, height: 0 });
		expect(computeTargetSize(100, 100, 0)).toEqual({ width: 0, height: 0 });
		expect(computeTargetSize(NaN, 100, 1200)).toEqual({ width: 0, height: 0 });
	});
});
