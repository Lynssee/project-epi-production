import { describe, expect, it } from 'vitest';
import { toWaNumber, waLink } from './waNumber';

describe('toWaNumber (U5)', () => {
	it('0812… → 62812… (tautan wa.me berfungsi)', () => {
		expect(toWaNumber('081234567890')).toBe('6281234567890');
		expect(toWaNumber('0812-3456-7890')).toBe('6281234567890');
	});
	it('+62 / 62 / 8xx / 0062 / 620…', () => {
		expect(toWaNumber('+62 812 3456 7890')).toBe('6281234567890');
		expect(toWaNumber('6281234567890')).toBe('6281234567890');
		expect(toWaNumber('81234567890')).toBe('6281234567890');
		expect(toWaNumber('0062 812 3456 7890')).toBe('6281234567890');
		expect(toWaNumber('6208123456789')).toBe('628123456789');
	});
	it('tidak valid / kosong → "" (tombol disembunyikan)', () => {
		for (const x of ['', null, undefined, 'abc', '0812', '441234567890', '628123456789012345']) {
			expect(toWaNumber(x as any)).toBe('');
		}
	});
});

describe('waLink', () => {
	it('membentuk tautan, teks di-encode; nomor buruk → ""', () => {
		expect(waLink('081234567890')).toBe('https://wa.me/6281234567890');
		expect(waLink('081234567890', 'Halo GA')).toBe('https://wa.me/6281234567890?text=Halo%20GA');
		expect(waLink('xx')).toBe('');
	});
});
