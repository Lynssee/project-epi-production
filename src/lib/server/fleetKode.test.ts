import { describe, expect, it } from 'vitest';
import { genKodeBooking, isKodeCollision, POLA_KODE_BOOKING, tanggalWib } from './fleetKode';

describe('tanggalWib (U3: tanggal = WIB)', () => {
	it('00:30 WIB di server UTC (17:30 UTC hari sebelumnya) tetap tanggal WIB', () => {
		expect(tanggalWib(new Date('2026-09-29T17:30:00Z'))).toBe('260930');
	});
	it('06:59 WIB & 07:00 WIB', () => {
		expect(tanggalWib(new Date('2026-09-29T23:59:00Z'))).toBe('260930');
		expect(tanggalWib(new Date('2026-09-30T00:00:00Z'))).toBe('260930');
	});
	it('pergantian tahun WIB', () => {
		expect(tanggalWib(new Date('2026-12-31T17:00:00Z'))).toBe('270101');
	});
});

describe('genKodeBooking', () => {
	it('format BK-YYMMDD-XXXXX tanpa karakter ambigu 0/O/1/I', () => {
		const kode = genKodeBooking(new Date('2026-09-30T05:00:00Z'));
		expect(kode).toMatch(POLA_KODE_BOOKING);
		expect(kode.startsWith('BK-260930-')).toBe(true);
		expect(kode.slice(10)).not.toMatch(/[01OI]/);
	});
	it('U3 (realistis): 10.000 kode di tanggal yang sama hampir tanpa kembar', () => {
		// Ruang kode 32^5 ≈ 33,5 juta → untuk 10.000 kode, harapan tabrakan ≈ n²/2N ≈ 1,5 (paradoks ulang tahun), jadi
		// "0 kembar" TIDAK dijamin secara matematis. Pengaman sebenarnya = unique index + retry (fleetKode dipakai bersama
		// keduanya). Volume nyata ±30/hari → peluang tabrakan ≈ 0,001%. Batas ≤10 aman (P(>10) ≈ 1e-6 untuk Poisson(1,5)).
		const now = new Date('2026-09-30T05:00:00Z');
		const set = new Set<string>();
		for (let i = 0; i < 10_000; i++) set.add(genKodeBooking(now));
		expect(10_000 - set.size).toBeLessThanOrEqual(10);
	});
	it('volume harian nyata (30 booking) — semua unik', () => {
		const now = new Date('2026-09-30T05:00:00Z');
		// dijalankan berulang agar sampel cukup; peluang gagal per iterasi ≈ 1,3e-5
		for (let r = 0; r < 20; r++) {
			const set = new Set<string>();
			for (let i = 0; i < 30; i++) set.add(genKodeBooking(now));
			expect(set.size).toBe(30);
		}
	});
	it('pola menerima sufiks pembersihan duplikat lama (-2, -3) dan menolak format lama', () => {
		expect(POLA_KODE_BOOKING.test('BK-260930-ABCDE-2')).toBe(true);
		expect(POLA_KODE_BOOKING.test('BK-260930-839')).toBe(false);
	});
});

describe('isKodeCollision (U4)', () => {
	it('mengenali error unik Directus/SQL; error lain bukan tabrakan', () => {
		expect(isKodeCollision(new Error('Value for field "kode_booking" in collection "fleet_bookings" has to be unique.'))).toBe(true);
		expect(isKodeCollision(new Error('RECORD_NOT_UNIQUE'))).toBe(true);
		expect(isKodeCollision(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed'))).toBe(true);
		expect(isKodeCollision(new Error('Connection refused'))).toBe(false);
		expect(isKodeCollision(null)).toBe(false);
	});
});
