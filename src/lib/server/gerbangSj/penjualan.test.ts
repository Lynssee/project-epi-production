import { describe, expect, it, vi } from 'vitest';

vi.mock('../directus', () => ({ directusServerJson: vi.fn() }));
vi.mock('./effects', () => ({}));

import { awalHariWib, isDiambilSendiri, perluGerbang } from './penjualan';
import { parseGerbangSettings, GERBANG_DEFAULTS } from './settings';

describe('SJ-09 opsi C — gerbang penjualan', () => {
	const wajib = new Set(['2']);
	const sj = { type: 'so_delivery', status: 'delivered', track_stage: null, security_verified_at: null, category: 2, delivery_address: 'Jl. Raya 1' };

	it('SJ penjualan hari ini kategori wajib satpam → perlu gerbang', () => {
		expect(perluGerbang(sj, wajib)).toBe(true);
	});
	it('bukan so_delivery / status bukan delivered → tidak', () => {
		expect(perluGerbang({ ...sj, type: null }, wajib)).toBe(false);
		expect(perluGerbang({ ...sj, status: 'shipped' }, wajib)).toBe(false);
	});
	it('sudah punya track_stage atau jejak verifikasi → tidak (anti dobel)', () => {
		expect(perluGerbang({ ...sj, track_stage: 'lolos_gerbang' }, wajib)).toBe(false);
		expect(perluGerbang({ ...sj, security_verified_at: '2026-10-07T01:00:00Z' }, wajib)).toBe(false);
	});
	it('kategori tidak wajib satpam → tidak', () => {
		expect(perluGerbang({ ...sj, category: 12 }, wajib)).toBe(false);
		expect(perluGerbang({ ...sj, category: { id: 2 } }, wajib)).toBe(true);
	});
	it('"Diambil Sendiri oleh Customer" tidak masuk antrean', () => {
		expect(isDiambilSendiri('Diambil Sendiri oleh Customer')).toBe(true);
		expect(isDiambilSendiri('diambil  sendiri')).toBe(true);
		expect(isDiambilSendiri('Lokasi Customer: PT. X')).toBe(false);
		expect(perluGerbang({ ...sj, delivery_address: 'Diambil Sendiri oleh Customer' }, wajib)).toBe(false);
	});
	it('awalHariWib = 00:00 WIB hari itu', () => {
		expect(awalHariWib(new Date('2026-10-07T18:30:00Z'))).toBe('2026-10-08T00:00:00+07:00'); // 01:30 WIB tgl 8
		expect(awalHariWib(new Date('2026-10-07T02:00:00Z'))).toBe('2026-10-07T00:00:00+07:00');
	});
	it('setelan gerbang_penjualan_aktif: default MATI, hanya true/1 yang menyalakan', () => {
		expect(GERBANG_DEFAULTS.penjualanAktif).toBe(false);
		expect(parseGerbangSettings([]).penjualanAktif).toBe(false);
		expect(parseGerbangSettings([{ setting_key: 'gerbang_penjualan_aktif', setting_value: 'true' }]).penjualanAktif).toBe(true);
		expect(parseGerbangSettings([{ setting_key: 'gerbang_penjualan_aktif', setting_value: 1 }]).penjualanAktif).toBe(true);
		expect(parseGerbangSettings([{ setting_key: 'gerbang_penjualan_aktif', setting_value: 'ya' }]).penjualanAktif).toBe(false);
	});
});
