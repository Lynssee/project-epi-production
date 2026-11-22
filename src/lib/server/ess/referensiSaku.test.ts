import { describe, it, expect } from 'vitest';
import { mapProfilToReferensi } from './referensiSaku';

describe('mapProfilToReferensi', () => {
	it('meringkas profil; tanpa nama → null', () => {
		const r = mapProfilToReferensi({ item_id: 5, is_kritis: true, ringkasan: 'Filter udara', panduan_pakai: { interval_ganti: { nilai: 500, satuan: 'jam' }, tanda_harus_ganti: ['indikator merah'] }, panduan_beli: { tanda_palsu: ['tanpa hologram'] }, apd: ['sarung tangan'], bahaya: 'Debu' }, 'FILTER');
		expect(r).toMatchObject({ itemId: 5, nama: 'FILTER', kritis: true, interval: '500 jam', tandaGanti: 'indikator merah', tandaPalsu: 'tanpa hologram', apd: ['sarung tangan'] });
		expect(mapProfilToReferensi({ item_id: 5 }, '')).toBeNull();
		expect(mapProfilToReferensi(null, 'X')).toBeNull();
	});
});

import { pickSpesifikasi } from './referensiSaku';

describe('pickSpesifikasi', () => {
	const defs = [
		{ key: 'rasio_campuran', label: 'Rasio campuran (A:B)', unit: '', kritis: true },
		{ key: 'pot_life', label: 'Pot life', unit: 'jam', kritis: true },
		{ key: 'dft', label: 'DFT per lapis', unit: 'µm', kritis: true },
		{ key: 'metode_aplikasi', label: 'Metode', kritis: false },
		{ key: 'wajib_sertifikat', label: 'Wajib sertifikat', kritis: true }
	];
	it('hanya kolom kritis yang terisi; satuan ditempel sekali; boolean → Ya/Tidak', () => {
		const r = pickSpesifikasi({ rasio_campuran: '4:1', pot_life: 4, dft: '100 µm', metode_aplikasi: 'roll', wajib_sertifikat: true }, defs);
		expect(r).toEqual([
			{ label: 'Rasio campuran (A:B)', nilai: '4:1' },
			{ label: 'Pot life', nilai: '4 jam' },
			{ label: 'DFT per lapis', nilai: '100 µm' },
			{ label: 'Wajib sertifikat', nilai: 'Ya' }
		]);
	});
	it('kosong/null/format salah → daftar kosong (tidak melempar)', () => {
		expect(pickSpesifikasi(null, defs)).toEqual([]);
		expect(pickSpesifikasi([], defs)).toEqual([]);
		expect(pickSpesifikasi({ pot_life: '' }, defs)).toEqual([]);
		expect(pickSpesifikasi({ pot_life: 4 }, [] as any)).toEqual([]);
	});
	it('mapProfilToReferensi memuat spesifikasi', () => {
		const r = mapProfilToReferensi({ item_id: 9, spec_values: { pot_life: 3 } }, 'EPOXY', defs);
		expect(r?.spesifikasi).toEqual([{ label: 'Pot life', nilai: '3 jam' }]);
	});
});
