import { describe, it, expect } from 'vitest';
import { parseKeyScan, pilihKunciKendaraan, truthy, isNonaktif, type KunciKendaraanRow } from './keyService';

describe('truthy / isNonaktif (boolean Directus bisa 0/1)', () => {
	it('truthy menerima true, 1, "1", "true"', () => {
		for (const v of [true, 1, '1', 'true']) expect(truthy(v)).toBe(true);
		for (const v of [false, 0, '0', 'false', null, undefined, '', 2]) expect(truthy(v)).toBe(false);
	});
	it('isNonaktif hanya untuk false eksplisit; null/undefined dianggap aktif', () => {
		for (const v of [false, 0, '0', 'false']) expect(isNonaktif(v)).toBe(true);
		for (const v of [true, 1, null, undefined]) expect(isNonaktif(v)).toBe(false);
	});
});

const row = (over: Partial<KunciKendaraanRow>): KunciKendaraanRow => ({
	id: 1,
	kode_kunci: 'KC-1',
	nama_kunci: 'Hilux',
	kendaraan_id: 10,
	tipe_salinan: 'utama',
	lokasi_kotak: 'Box A',
	nomor_hook: 'A-1',
	status: 'tersedia',
	...over
});

describe('parseKeyScan', () => {
	it('membuang awalan KEY: dan spasi', () => {
		expect(parseKeyScan(' KEY:ABC123 ')).toBe('ABC123');
		expect(parseKeyScan('key: ABC')).toBe('ABC');
		expect(parseKeyScan('KC-KDR-001')).toBe('KC-KDR-001');
	});
	it('null/undefined → string kosong', () => {
		expect(parseKeyScan(null)).toBe('');
		expect(parseKeyScan(undefined)).toBe('');
	});
});

describe('pilihKunciKendaraan', () => {
	it('mendahulukan salinan utama', () => {
		const r = pilihKunciKendaraan([row({ id: 2, tipe_salinan: 'cadangan_1', nomor_hook: 'A-2' }), row({ id: 3, tipe_salinan: 'utama', nomor_hook: 'A-3' })], 10);
		expect(r?.id).toBe(3);
	});
	it('tidak pernah memilih kunci brankas (disimpan_khusus)', () => {
		expect(pilihKunciKendaraan([row({ status: 'disimpan_khusus' })], 10)).toBeNull();
	});
	it('kendaraan lain / tidak ada → null', () => {
		expect(pilihKunciKendaraan([row({ kendaraan_id: 99 })], 10)).toBeNull();
		expect(pilihKunciKendaraan([], 10)).toBeNull();
		expect(pilihKunciKendaraan(null as unknown as KunciKendaraanRow[], 10)).toBeNull();
	});
	it('status dipinjam tetap dikembalikan (UI menampilkan "sedang dipinjam")', () => {
		expect(pilihKunciKendaraan([row({ status: 'dipinjam' })], 10)?.status).toBe('dipinjam');
	});
});
