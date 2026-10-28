import { describe, it, expect } from 'vitest';
import { signDokumen, verifyDokumen, canonicalId, readSecret, buildVerifyUrl, isJenisVerifikasi } from './verifikasiDokumen';

const SECRET = 'test-secret-0123456789abcdef';

describe('KONTRAK LINTAS-REPO — vektor tetap (harus sama persis dengan erp-epi/verifikasiDokumen.test.js)', () => {
	it('tanda tangan deterministik untuk rahasia/jenis/id tetap', () => {
		expect(signDokumen(SECRET, 'pa', 123)).toBe('rVn5NppfebhstXoohhJv8n5r');
		expect(signDokumen(SECRET, 'bdp', 45)).toBe('lTIFYlrey3hQSvVi-2Y09lGj');
		expect(signDokumen('lain-secret-0123456789abcdef', 'pa', 123)).toBe('D2V5ez3eT4BxhEQ0y0d3Yf4b');
	});
});

describe('verifyDokumen', () => {
	it('menerima tanda tangan sah; id bisa number atau string', () => {
		const sig = signDokumen(SECRET, 'pa', 123);
		expect(verifyDokumen(SECRET, 'pa', 123, sig)).toBe(true);
		expect(verifyDokumen(SECRET, 'pa', '123', sig)).toBe(true);
	});
	it('menolak: id/jenis lain, rahasia lain, tanda tangan diubah/terpotong/bukan string', () => {
		const sig = signDokumen(SECRET, 'pa', 123);
		expect(verifyDokumen(SECRET, 'pa', 124, sig)).toBe(false);
		expect(verifyDokumen(SECRET, 'bdp', 123, sig)).toBe(false);
		expect(verifyDokumen('rahasia-lain-0123456789abcd', 'pa', 123, sig)).toBe(false);
		expect(verifyDokumen(SECRET, 'pa', 123, sig.slice(0, -1) + (sig.endsWith('a') ? 'b' : 'a'))).toBe(false);
		expect(verifyDokumen(SECRET, 'pa', 123, sig.slice(0, 20))).toBe(false);
		expect(verifyDokumen(SECRET, 'pa', 123, 12345 as any)).toBe(false);
		expect(verifyDokumen(SECRET, 'pa', 123, null)).toBe(false);
	});
	it('input berbahaya/salah bentuk tidak melempar dan ditolak', () => {
		const sig = signDokumen(SECRET, 'pa', 1);
		expect(verifyDokumen(SECRET, 'xx', 1, sig)).toBe(false);
		expect(verifyDokumen(SECRET, 'pa', '1; DROP', sig)).toBe(false);
		expect(verifyDokumen(SECRET, 'pa', '01', sig)).toBe(false);
		expect(verifyDokumen('', 'pa', 1, sig)).toBe(false);
	});
});

describe('helper', () => {
	it('canonicalId hanya bilangan bulat positif tanpa nol di depan', () => {
		expect(canonicalId(7)).toBe('7');
		for (const bad of ['0', '007', '-1', '1.5', '1e3', '', null, undefined, 'abc', '1'.repeat(13)]) expect(canonicalId(bad as any)).toBeNull();
	});
	it('readSecret mematikan fitur bila kosong/pendek', () => {
		expect(readSecret(undefined)).toBeNull();
		expect(readSecret('pendek')).toBeNull();
		expect(readSecret('  ' + SECRET + ' ')).toBe(SECRET);
	});
	it('signDokumen melempar untuk parameter tidak valid', () => {
		expect(() => signDokumen('', 'pa', 1)).toThrow();
		expect(() => signDokumen(SECRET, 'x' as any, 1)).toThrow();
		expect(() => signDokumen(SECRET, 'pa', '0')).toThrow();
	});
	it('buildVerifyUrl & isJenisVerifikasi', () => {
		expect(buildVerifyUrl('https://project.eltamaprimaindo.com/', 'pa', 9, 'abc_-')).toBe('https://project.eltamaprimaindo.com/verifikasi/pa/9?s=abc_-');
		expect(isJenisVerifikasi('pa')).toBe(true);
		expect(isJenisVerifikasi('pr')).toBe(false);
	});
});
