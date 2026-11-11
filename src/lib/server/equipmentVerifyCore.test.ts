import { describe, it, expect } from 'vitest';
import {
	DEFAULT_VERIFY_SETTINGS as S,
	decideBorrowerMatch,
	decideVehicleAccess,
	normalizeVerifySettings,
	pickActiveBooking,
	type BookingLite
} from './equipmentVerifyCore';

const NOW = Date.parse('2026-11-06T08:00:00Z');
const iso = (offsetMin: number) => new Date(NOW + offsetMin * 60_000).toISOString();
const bk = (o: Partial<BookingLite> = {}): BookingLite => ({
	id: 'b1',
	kode_booking: 'BK-1',
	driver_id: 'drv-1',
	karyawan_id: '10',
	butuh_driver: false,
	requester_name: 'Budi',
	tujuan: 'Cikarang',
	status: 'aktif',
	tanggal_mulai: iso(-60),
	tanggal_selesai_rencana: iso(120),
	...o
});

describe('normalizeVerifySettings', () => {
	it('baris kosong => bawaan', () => {
		expect(normalizeVerifySettings([])).toEqual(S);
		expect(normalizeVerifySettings(null)).toEqual(S);
	});
	it('menerapkan nilai valid, menjepit di batas, dan mengabaikan sampah', () => {
		const r = normalizeVerifySettings([
			{ key: 'driver_lock_grace_menit', value: '15' },
			{ key: 'driver_lock_basi_jam', value: 0 },
			{ key: 'driver_lock_alasan_min', value: 'abc' },
			{ key: 'driver_lock_izin_penembus', value: 'admin_panel, fleet_manager ,' }
		]);
		expect(r.graceMinutes).toBe(15);
		expect(r.staleAfterHours).toBe(1);
		expect(r.handoverReasonMin).toBe(S.handoverReasonMin);
		expect(r.overridePermissions).toEqual(['admin_panel', 'fleet_manager']);
	});
});

describe('pickActiveBooking', () => {
	it('aktif dalam rencana => dipilih', () => {
		expect(pickActiveBooking([bk()], NOW, S).booking?.id).toBe('b1');
	});
	it("'disetujui' hanya dalam jendela +- grace", () => {
		const approved = bk({ status: 'disetujui', tanggal_mulai: iso(30), tanggal_selesai_rencana: iso(200) });
		expect(pickActiveBooking([approved], NOW, S).booking).not.toBeNull(); // mulai 30 mnt lagi, grace 60
		expect(pickActiveBooking([bk({ status: 'disetujui', tanggal_mulai: iso(180), tanggal_selesai_rencana: iso(300) })], NOW, S).booking).toBeNull();
		expect(pickActiveBooking([bk({ status: 'disetujui', tanggal_mulai: iso(-300), tanggal_selesai_rencana: iso(-200) })], NOW, S).booking).toBeNull();
	});
	it('aktif yang molor melewati rencana TIDAK dianggap basi sampai batas stale (driver tidak terkunci keluar)', () => {
		const overrun = bk({ tanggal_mulai: iso(-600), tanggal_selesai_rencana: iso(-300) });
		expect(pickActiveBooking([overrun], NOW, S).booking?.id).toBe('b1');
	});
	it('aktif basi (> staleAfterHours lewat rencana) diabaikan & dilaporkan', () => {
		const stale = bk({ tanggal_mulai: iso(-60 * 80), tanggal_selesai_rencana: iso(-60 * 70) });
		const r = pickActiveBooking([stale], NOW, S);
		expect(r.booking).toBeNull();
		expect(r.staleIgnored).toHaveLength(1);
	});
	it('booking harian tanpa tanggal_selesai_rencana dianggap berlaku 24 jam', () => {
		const daily = bk({ status: 'disetujui', tanggal_selesai_rencana: null, tanggal_mulai: iso(-600) });
		expect(pickActiveBooking([daily], NOW, S).booking).not.toBeNull();
	});
	it("prioritas 'aktif' di atas 'disetujui'", () => {
		const a = bk({ id: 'approved', status: 'disetujui', tanggal_mulai: iso(10) });
		const b = bk({ id: 'running' });
		expect(pickActiveBooking([a, b], NOW, S).booking?.id).toBe('running');
	});
});

describe('decideVehicleAccess', () => {
	const base = { mode: 'hard' as const, pemilik: 'perusahaan', driverKaryawanId: '20', defaultDriverKaryawanId: null };
	it('driver booking => authorized (semua mode)', () => {
		for (const mode of ['shadow', 'soft', 'warn', 'hard'] as const) {
			const v = decideVehicleAccess({ ...base, mode, karyawanId: '20', booking: bk({ butuh_driver: true }) });
			expect(v).toMatchObject({ decision: 'authorized', isAuthorized: true, blocked: false, warn: false, attempt: false });
		}
	});
	it('pemohon tanpa driver terpisah (nyetir sendiri) => authorized', () => {
		const v = decideVehicleAccess({ ...base, karyawanId: '10', driverKaryawanId: null, booking: bk() });
		expect(v.decision).toBe('authorized');
	});
	it('pemohon yang dilayani driver lain => passenger (bukan denied, tidak diblokir)', () => {
		const v = decideVehicleAccess({ ...base, karyawanId: '10', booking: bk({ butuh_driver: true }) });
		expect(v).toMatchObject({ decision: 'passenger', isAuthorized: false, blocked: false, attempt: false });
	});
	it('orang lain: hard => blokir; soft/warn => peringatan; shadow => hanya tercatat sebagai upaya', () => {
		const input = { ...base, karyawanId: '99', booking: bk({ butuh_driver: true }) };
		const hard = decideVehicleAccess({ ...input, mode: 'hard' });
		expect(hard).toMatchObject({ decision: 'denied', blocked: true, warn: false, attempt: true });
		expect(hard.message).toContain('Budi');
		expect(hard.message).toContain('Cikarang');
		for (const mode of ['soft', 'warn'] as const) {
			expect(decideVehicleAccess({ ...input, mode })).toMatchObject({ decision: 'denied', blocked: false, warn: true, attempt: true });
		}
		expect(decideVehicleAccess({ ...input, mode: 'shadow' })).toMatchObject({ decision: 'denied', blocked: false, warn: false, attempt: true, message: null });
	});
	it('tanpa booking => free, TIDAK pernah dikunci; driver tetap unit => authorized', () => {
		expect(decideVehicleAccess({ ...base, karyawanId: '99', booking: null, driverKaryawanId: null })).toMatchObject({ decision: 'free', blocked: false, attempt: false });
		expect(decideVehicleAccess({ ...base, karyawanId: '77', booking: null, driverKaryawanId: null, defaultDriverKaryawanId: '77' }).decision).toBe('authorized');
	});
	it('aset pribadi atau identitas tak terbaca => not_applicable (fail-open)', () => {
		expect(decideVehicleAccess({ ...base, karyawanId: '99', pemilik: 'pribadi', booking: bk() }).decision).toBe('not_applicable');
		expect(decideVehicleAccess({ ...base, karyawanId: null, booking: bk() }).decision).toBe('not_applicable');
	});
});

describe('decideBorrowerMatch', () => {
	it('peminjam = pengisi => match', () => {
		expect(decideBorrowerMatch({ mode: 'warn', karyawanId: '5', hasLoan: true, borrowerKaryawanId: '5' })).toMatchObject({ decision: 'match', matches: true, warn: false });
	});
	it('beda orang => mismatch: warn di mode non-shadow, tidak pernah memblokir', () => {
		const v = decideBorrowerMatch({ mode: 'hard', karyawanId: '5', hasLoan: true, borrowerKaryawanId: '6' });
		expect(v).toMatchObject({ decision: 'mismatch', matches: false, warn: true });
		expect(decideBorrowerMatch({ mode: 'shadow', karyawanId: '5', hasLoan: true, borrowerKaryawanId: '6' }).warn).toBe(false);
	});
	it('tanpa loan / peminjam tak tercatat / identitas tak terbaca', () => {
		expect(decideBorrowerMatch({ mode: 'warn', karyawanId: '5', hasLoan: false, borrowerKaryawanId: null }).decision).toBe('no_loan');
		expect(decideBorrowerMatch({ mode: 'warn', karyawanId: '5', hasLoan: true, borrowerKaryawanId: null })).toMatchObject({ decision: 'unknown_borrower', warn: true });
		expect(decideBorrowerMatch({ mode: 'warn', karyawanId: null, hasLoan: true, borrowerKaryawanId: '5' }).decision).toBe('not_applicable');
	});
});

import { decideOverride, isReasonValid, normalizeReason } from './equipmentVerifyCore';

describe('decideOverride', () => {
	it('soft: siapa pun dengan alasan; warn: cukup konfirmasi; hard: hanya pemegang permission', () => {
		expect(decideOverride('soft', false, 30)).toEqual({ allowed: true, reasonMin: 30 });
		expect(decideOverride('warn', false, 30)).toEqual({ allowed: true, reasonMin: 0 });
		expect(decideOverride('hard', false, 30)).toEqual({ allowed: false, reasonMin: 30 });
		expect(decideOverride('hard', true, 30)).toEqual({ allowed: true, reasonMin: 30 });
	});
});

describe('normalizeReason / isReasonValid', () => {
	it('membuang pemisah "|" & newline, merapikan spasi, memotong 300 karakter', () => {
		expect(normalizeReason('  sakit |\n driver   utama  ')).toBe('sakit driver utama');
		expect(normalizeReason('x'.repeat(500))).toHaveLength(300);
		expect(normalizeReason(null)).toBe('');
	});
	it('validasi panjang minimum dihitung SETELAH dibersihkan', () => {
		expect(isReasonValid(normalizeReason('a|||||||||b'), 5)).toBe(false);
		expect(isReasonValid('x'.repeat(30), 30)).toBe(true);
		expect(isReasonValid('', 0)).toBe(true);
	});
});

import { sanitizeGps } from './equipmentVerifyCore';

describe('sanitizeGps', () => {
	it('menerima koordinat valid, membulatkan akurasi', () => {
		expect(sanitizeGps({ lat: -6.2, lng: 106.8, accuracy: 12.7 })).toEqual({ lat: -6.2, lng: 106.8, accuracy: 13 });
		expect(sanitizeGps({ lat: 0, lng: 0 })).toEqual({ lat: 0, lng: 0 });
	});
	it('menolak bukan-objek, bukan-angka (string/NaN/Infinity), dan di luar rentang', () => {
		for (const bad of [null, undefined, 'x', 5, {}, { lat: '1', lng: '2' }, { lat: NaN, lng: 1 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: Infinity, lng: 0 }]) {
			expect(sanitizeGps(bad)).toBeNull();
		}
	});
	it('akurasi tidak valid dibuang, koordinat tetap', () => {
		expect(sanitizeGps({ lat: 1, lng: 2, accuracy: -5 })).toEqual({ lat: 1, lng: 2 });
		expect(sanitizeGps({ lat: 1, lng: 2, accuracy: 'tinggi' })).toEqual({ lat: 1, lng: 2 });
	});
});
