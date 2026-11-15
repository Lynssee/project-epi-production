import { describe, it, expect } from 'vitest';
import { nilaiBoronganRiil, pesanNilaiBorongan, NILAI_BORONGAN_MIN_DEFAULT } from './boronganNilai';

describe('nilaiBoronganRiil', () => {
	it('Rp1, kosong, NaN tidak riil; batas minimum inklusif', () => {
		expect(nilaiBoronganRiil(1)).toBe(false);
		expect(nilaiBoronganRiil('')).toBe(false);
		expect(nilaiBoronganRiil('abc')).toBe(false);
		expect(nilaiBoronganRiil(NILAI_BORONGAN_MIN_DEFAULT - 1)).toBe(false);
		expect(nilaiBoronganRiil(NILAI_BORONGAN_MIN_DEFAULT)).toBe(true);
		expect(nilaiBoronganRiil('37996000')).toBe(true);
		expect(nilaiBoronganRiil(450_000, 500_000)).toBe(false);
	});
});

describe('pesanNilaiBorongan', () => {
	it('kosong/0 → minta diisi; Rp1 → pesan SPK riil dengan minimum; riil → null', () => {
		expect(pesanNilaiBorongan('')).toBe('Isi nilai borongan');
		expect(pesanNilaiBorongan(0)).toBe('Isi nilai borongan');
		const m = pesanNilaiBorongan(1);
		expect(m).toMatch(/SPK yang sebenarnya/);
		expect(m).toContain('Rp100.000');
		expect(pesanNilaiBorongan(5_000_000)).toBeNull();
		expect(pesanNilaiBorongan(450_000, 500_000)).toContain('Rp500.000');
	});
});
