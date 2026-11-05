import { describe, it, expect } from 'vitest';
import { gabungFoto, namaKategoriResmi, susunImpor, tambahBaris, tentukanJenis } from './kioskCatatan';

const PROGRES = ['Progres kerja', 'Hasil kerja', 'Lainnya'];
const KENDALA = ['Kendala', 'K3 / bahaya', 'Bahan / alat habis'];

describe('tentukanJenis / namaKategoriResmi', () => {
	it('mengenali jenis, abaikan huruf besar-kecil & spasi; asing → null', () => {
		expect(tentukanJenis('progres kerja', PROGRES, KENDALA)).toBe('progres');
		expect(tentukanJenis('  K3 / BAHAYA ', PROGRES, KENDALA)).toBe('kendala');
		expect(tentukanJenis('ngawur', PROGRES, KENDALA)).toBeNull();
		expect(tentukanJenis('', PROGRES, KENDALA)).toBeNull();
		expect(tentukanJenis(undefined, PROGRES, KENDALA)).toBeNull();
	});
	it('nama resmi mengikuti penulisan di setelan', () => {
		expect(namaKategoriResmi('k3 / bahaya', PROGRES, KENDALA)).toBe('K3 / bahaya');
		expect(namaKategoriResmi('asing', PROGRES, KENDALA)).toBe('asing');
	});
});

describe('susunImpor', () => {
	it('memisahkan foto & teks per bagian laporan; yang kosong dilewati', () => {
		const h = susunImpor([
			{ id: 1, manpower_nama: 'Agus', jenis: 'progres', kategori: 'Progres kerja', catatan: 'Primer lantai 2  selesai', foto: 'f1' },
			{ id: 2, manpower_nama: 'Cahyo', jenis: 'kendala', kategori: 'Bahan / alat habis', catatan: '', foto: 'f2' },
			{ id: 3, manpower_nama: 'Dedi', jenis: 'kendala', kategori: 'Kendala', catatan: 'Kabel roll habis', foto: null },
			{ id: 4, manpower_nama: 'Kosong', jenis: 'progres', kategori: 'Lainnya', catatan: '  ', foto: null }
		]);
		expect(h.fotoProgres).toEqual(['f1']);
		expect(h.fotoKendala).toEqual(['f2']);
		expect(h.teksProgres).toEqual(['• Agus (Progres kerja): Primer lantai 2 selesai']);
		expect(h.teksKendala).toEqual(['• Cahyo (Bahan / alat habis): lihat foto', '• Dedi (Kendala): Kabel roll habis']);
	});
	it('null/undefined/entri rusak aman', () => {
		expect(susunImpor(null)).toEqual({ fotoProgres: [], fotoKendala: [], teksProgres: [], teksKendala: [] });
		expect(susunImpor([null as any, { id: 9, jenis: null }]).teksProgres).toEqual([]);
	});
});

describe('tambahBaris & gabungFoto (impor ulang aman)', () => {
	it('menambah di bawah teks leader, tanpa menimpa; baris sama tidak diulang', () => {
		const a = tambahBaris('Cuaca cerah', ['• Agus: A']);
		expect(a).toBe('Cuaca cerah\n• Agus: A');
		expect(tambahBaris(a, ['• Agus: A', '• Budi: B'])).toBe('Cuaca cerah\n• Agus: A\n• Budi: B');
		expect(tambahBaris(a, ['• Agus: A'])).toBe(a);
	});
	it('placeholder "-" dan kosong tidak ikut terbawa', () => {
		expect(tambahBaris('-', ['• A: x'])).toBe('• A: x');
		expect(tambahBaris('', ['• A: x'])).toBe('• A: x');
		expect(tambahBaris(null, ['• A: x'])).toBe('• A: x');
		expect(tambahBaris('Teks', [])).toBe('Teks');
	});
	it('gabungFoto tanpa duplikat, urutan lama tetap', () => {
		expect(gabungFoto(['a', 'b'], ['b', 'c', '', 'a'])).toEqual(['a', 'b', 'c']);
		expect(gabungFoto(null, ['x'])).toEqual(['x']);
	});
});
