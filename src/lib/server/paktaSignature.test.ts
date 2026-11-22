import { describe, it, expect } from 'vitest';
import { signPakta, verifyPakta, trySignPakta, readPaktaSecret, canonicalWaktu, type PaktaSignInput } from './paktaSignature';

const SECRET = 'rahasia-uji-pakta-1';
const SOP: PaktaSignInput = { karyawanId: 123, docType: 'sop', docKey: 45, version: 3, confirmedAt: '2026-11-13T05:00:00Z', ip: '10.0.0.1' };
const FLOW: PaktaSignInput = { karyawanId: 123, docType: 'flow', docKey: 'opname_site', version: 2, confirmedAt: '2026-11-13T05:00:00Z' };

describe('paktaSignature', () => {
	it('vektor tetap — HARUS sama dengan salinan erp-epi (paktaSignature.test.js)', () => {
		expect(signPakta(SECRET, SOP)).toBe('DeuQTJuBo2K4aSc6bJHeM6g8');
		expect(signPakta(SECRET, FLOW)).toBe('7ARs2ASrN9AtAT3grX5ucWtf');
	});

	it('deterministik & tahan format waktu Directus (milidetik / offset)', () => {
		expect(signPakta(SECRET, { ...SOP, confirmedAt: '2026-11-13T05:00:00.000Z' })).toBe(signPakta(SECRET, SOP));
		expect(signPakta(SECRET, { ...SOP, confirmedAt: new Date('2026-11-13T12:00:00+07:00') })).toBe(signPakta(SECRET, SOP));
	});

	it('setiap komponen mengubah kode (versi, dokumen, orang, waktu, IP, jenis)', () => {
		const base = signPakta(SECRET, SOP);
		for (const ubah of [{ version: 4 }, { docKey: 46 }, { karyawanId: 124 }, { confirmedAt: '2026-11-13T05:00:01Z' }, { ip: '10.0.0.2' }, { docType: 'gate' as const }]) {
			expect(signPakta(SECRET, { ...SOP, ...ubah })).not.toBe(base);
		}
		expect(signPakta('rahasia-lain-0123456', SOP)).not.toBe(base);
	});

	it('verifyPakta: benar → true; kode/komponen diubah → false; salah bentuk tidak melempar', () => {
		const kode = signPakta(SECRET, SOP);
		expect(verifyPakta(SECRET, SOP, kode)).toBe(true);
		expect(verifyPakta(SECRET, { ...SOP, version: 99 }, kode)).toBe(false);
		expect(verifyPakta(SECRET, SOP, kode.slice(0, 23) + 'x')).toBe(false);
		expect(verifyPakta(SECRET, SOP, 'pendek')).toBe(false);
		expect(verifyPakta(SECRET, SOP, null)).toBe(false);
		expect(verifyPakta('', SOP, kode)).toBe(false);
		expect(verifyPakta(SECRET, { ...SOP, karyawanId: 'abc' }, kode)).toBe(false);
	});

	it('menolak parameter tak valid (pemisah, waktu rusak, karyawan non-positif)', () => {
		expect(() => signPakta(SECRET, { ...SOP, docKey: 'a|b' })).toThrow();
		expect(() => signPakta(SECRET, { ...SOP, confirmedAt: 'bukan-tanggal' })).toThrow();
		expect(() => signPakta(SECRET, { ...SOP, karyawanId: 0 })).toThrow();
		expect(() => signPakta('', SOP)).toThrow();
	});

	it('trySignPakta: tanpa rahasia / parameter rusak → null (konfirmasi tetap boleh tercatat)', () => {
		expect(trySignPakta(null, SOP)).toBeNull();
		expect(trySignPakta(SECRET, { ...SOP, version: '' })).toBeNull();
		expect(trySignPakta(SECRET, SOP)).toBe(signPakta(SECRET, SOP));
	});

	it('readPaktaSecret: minimal 16 karakter', () => {
		expect(readPaktaSecret('pendek')).toBeNull();
		expect(readPaktaSecret(undefined)).toBeNull();
		expect(readPaktaSecret('  0123456789abcdef  ')).toBe('0123456789abcdef');
	});

	it('canonicalWaktu', () => {
		expect(canonicalWaktu('2026-11-13T05:00:00.999Z')).toBe('2026-11-13T05:00:00Z');
		expect(canonicalWaktu('')).toBeNull();
		expect(canonicalWaktu('xx')).toBeNull();
	});
});
