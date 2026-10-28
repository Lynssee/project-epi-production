import { describe, expect, it } from 'vitest';
import { adaLabelPotensiDobel, isBookingBeruangMuka, keputusanDobel, labelPotensiDobel } from './advanceDouble';

describe('isBookingBeruangMuka', () => {
	it('hanya bila diminta dan statusnya masih berlaku', () => {
		expect(isBookingBeruangMuka({ advance_diminta: true, advance_status: 'dicairkan' })).toBe(true);
		expect(isBookingBeruangMuka({ advance_diminta: true, advance_status: 'menunggu_kasir' })).toBe(true);
		expect(isBookingBeruangMuka({ advance_diminta: true, advance_status: 'diajukan' })).toBe(true);
		expect(isBookingBeruangMuka({ advance_diminta: true, advance_status: 'ditolak' })).toBe(false);
		expect(isBookingBeruangMuka({ advance_diminta: true, advance_status: 'dibatalkan' })).toBe(false);
		expect(isBookingBeruangMuka({ advance_diminta: true, advance_status: 'none' })).toBe(false);
		expect(isBookingBeruangMuka({ advance_diminta: false, advance_status: 'dicairkan' })).toBe(false);
		// Directus live mengembalikan boolean sebagai 1/0 (terverifikasi 1 Okt 2026)
		expect(isBookingBeruangMuka({ advance_diminta: 1 as any, advance_status: 'dicairkan' })).toBe(true);
		expect(isBookingBeruangMuka({ advance_diminta: '1' as any, advance_status: 'dicairkan' })).toBe(true);
		expect(isBookingBeruangMuka({ advance_diminta: 0 as any, advance_status: 'dicairkan' })).toBe(false);
		expect(isBookingBeruangMuka(null)).toBe(false);
		expect(isBookingBeruangMuka({})).toBe(false);
	});
});

describe('keputusanDobel (G_ADVANCE_NO_DOUBLE)', () => {
	const dasar = { modeBiaya: 'talangan', jenis: 'bbm', beruangMuka: true };
	it('shadow → catat, soft → label, hard → blokir', () => {
		expect(keputusanDobel({ ...dasar, gateMode: 'shadow' })).toBe('catat');
		expect(keputusanDobel({ ...dasar, gateMode: 'soft' })).toBe('label');
		expect(keputusanDobel({ ...dasar, gateMode: 'hard' })).toBe('blokir');
	});
	it('bukan trip beruang muka / Dana Proyek / jenis lain → lolos di semua mode', () => {
		for (const gateMode of ['shadow', 'soft', 'hard'] as const) {
			expect(keputusanDobel({ ...dasar, gateMode, beruangMuka: false })).toBe('lolos');
			expect(keputusanDobel({ ...dasar, gateMode, modeBiaya: 'proyek' })).toBe('lolos');
			expect(keputusanDobel({ ...dasar, gateMode, jenis: 'lain' })).toBe('lolos');
		}
	});
	it('tol dan parkir ikut tercakup', () => {
		expect(keputusanDobel({ ...dasar, gateMode: 'hard', jenis: 'tol' })).toBe('blokir');
		expect(keputusanDobel({ ...dasar, gateMode: 'hard', jenis: 'parkir' })).toBe('blokir');
	});
});

describe('label', () => {
	it('format & deteksi', () => {
		expect(labelPotensiDobel(12, 'BK-261001-ABCDE')).toBe('[POTENSI DOBEL: trip 12 BK-261001-ABCDE]');
		expect(labelPotensiDobel('x')).toBe('[POTENSI DOBEL: trip x]');
		expect(adaLabelPotensiDobel('Biaya BBM [POTENSI DOBEL: trip 1]')).toBe(true);
		expect(adaLabelPotensiDobel('biasa')).toBe(false);
		expect(adaLabelPotensiDobel(null)).toBe(false);
	});
});
