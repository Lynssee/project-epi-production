import { describe, expect, it } from 'vitest';
import { filterRiwayatMilik, isBookingOwner, isBookingOwnerForRead, pesanTolakTulis, PESAN_BELUM_TERTAUT, PESAN_BUKAN_PEMILIK } from './fleetBookingOwner';

const budiA = { id: 1, nama_karyawan: 'Budi Santoso' };
const budiB = { id: 2, nama_karyawan: 'Budi Santoso' }; // nama SAMA, orang berbeda

describe('isBookingOwner — aksi tulis wajib karyawan_id (U1)', () => {
	const bookingA = { karyawan_id: '1', requester_name: 'Budi Santoso' };
	it('pemilik sah lolos (id number/string)', () => {
		expect(isBookingOwner(bookingA, budiA)).toBe(true);
		expect(isBookingOwner({ karyawan_id: 1 }, budiA)).toBe(true);
	});
	it('karyawan bernama SAMA tetapi id berbeda DITOLAK', () => {
		expect(isBookingOwner(bookingA, budiB)).toBe(false);
	});
	it('U2: baris lama tanpa karyawan_id TIDAK bisa ditulis, walau namanya sama', () => {
		expect(isBookingOwner({ karyawan_id: null, requester_name: 'Budi Santoso' }, budiA)).toBe(false);
		expect(isBookingOwner({ requester_name: 'Budi Santoso' }, budiA)).toBe(false);
		expect(isBookingOwner({ karyawan_id: '', requester_name: 'Budi Santoso' }, budiA)).toBe(false);
	});
});

describe('isBookingOwnerForRead', () => {
	it('baris lama tanpa id: terbaca oleh pemilik nama (tak peka kapitalisasi/spasi)', () => {
		expect(isBookingOwnerForRead({ karyawan_id: null, requester_name: '  BUDI santoso ' }, budiA)).toBe(true);
	});
	it('baris ber-id milik orang lain TIDAK terbaca walau namanya sama', () => {
		expect(isBookingOwnerForRead({ karyawan_id: '1', requester_name: 'Budi Santoso' }, budiB)).toBe(false);
	});
	it('nama kosong tidak pernah cocok; pemilik id tetap lolos', () => {
		expect(isBookingOwnerForRead({ karyawan_id: null, requester_name: '' }, { id: 3, nama_karyawan: '' })).toBe(false);
		expect(isBookingOwnerForRead({ karyawan_id: '1' }, budiA)).toBe(true);
	});
});

describe('pesan & filter', () => {
	it('pesan penolakan ramah & sesuai keadaan', () => {
		expect(pesanTolakTulis({ karyawan_id: '9' })).toBe(PESAN_BUKAN_PEMILIK);
		expect(pesanTolakTulis({ karyawan_id: null })).toBe(PESAN_BELUM_TERTAUT);
		expect(PESAN_BUKAN_PEMILIK).toContain('Hubungi GA');
	});
	it('filter riwayat: id sendiri ATAU (id kosong DAN nama sama)', () => {
		expect(filterRiwayatMilik(budiA)).toEqual({
			_or: [
				{ karyawan_id: { _eq: '1' } },
				{ _and: [{ karyawan_id: { _null: true } }, { requester_name: { _eq: 'Budi Santoso' } }] }
			]
		});
	});
});
