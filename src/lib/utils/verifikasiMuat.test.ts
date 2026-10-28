import { describe, expect, it } from 'vitest';
import { geserQty, ringkasVerifikasi, validasiVerifikasi, type BarisVerif, type ItemSj } from './verifikasiMuat';

const items: ItemSj[] = [
	{ id: 1, nama_barang: 'Cat A', qty_delivered: 12, unit: 'kg' },
	{ id: 2, nama_barang: 'Thinner A', qty_delivered: 10, unit: 'L' },
	{ id: 3, nama_barang: 'Kuas', qty_required: 3, qty_delivered: 0, unit: 'pcs' }
];
const r = (o: Partial<BarisVerif> = {}): BarisVerif => ({ status: '', qty: '', alasan: '', note: '', ...o });

describe('validasiVerifikasi (SJ-06 Layar C)', () => {
	it('belum ditandai semua → satu galat per item (tombol simpan nonaktif)', () => {
		expect(validasiVerifikasi(items, { '1': r({ status: 'sesuai' }), '2': r(), '3': r() }).map((g) => g.id)).toEqual(['2', '3']);
	});
	it('semua sesuai → valid', () => {
		expect(validasiVerifikasi(items, { '1': r({ status: 'sesuai' }), '2': r({ status: 'sesuai' }), '3': r({ status: 'sesuai' }) })).toEqual([]);
	});
	it('jumlah beda wajib qty < qty SJ dan alasan >= 5 huruf', () => {
		const rows: Record<string, BarisVerif> = { '1': r({ status: 'sesuai' }), '2': r({ status: 'qty_dikoreksi', qty: '8', note: 'x' }), '3': r({ status: 'sesuai' }) };
		expect(validasiVerifikasi(items, rows)[0].pesan).toMatch(/alasan/);
		rows['2'] = r({ status: 'qty_dikoreksi', qty: '10', note: 'kurang dua liter' });
		expect(validasiVerifikasi(items, rows)[0].pesan).toMatch(/Sesuai/);
		rows['2'] = r({ status: 'qty_dikoreksi', qty: '', note: 'kurang dua liter' });
		expect(validasiVerifikasi(items, rows)[0].pesan).toMatch(/jumlah/i);
		rows['2'] = r({ status: 'qty_dikoreksi', qty: '8', note: 'kurang dua liter' });
		expect(validasiVerifikasi(items, rows)).toEqual([]);
	});
	it('tidak ada wajib alasan; qty_required dipakai bila qty_delivered 0', () => {
		const rows: Record<string, BarisVerif> = { '1': r({ status: 'sesuai' }), '2': r({ status: 'sesuai' }), '3': r({ status: 'tidak_dimuat', note: 'abc' }) };
		expect(validasiVerifikasi(items, rows)[0].pesan).toMatch(/alasan/);
		rows['3'] = r({ status: 'tidak_dimuat', note: 'Tertinggal' });
		expect(validasiVerifikasi(items, rows)).toEqual([]);
		rows['3'] = r({ status: 'qty_dikoreksi', qty: '3', note: 'Tertinggal' });
		expect(validasiVerifikasi(items, rows)[0].pesan).toMatch(/kurang dari 3/);
	});
});

describe('ringkasVerifikasi', () => {
	it('contoh tiket: 1 sesuai, 1 jumlah beda, 1 tidak ada', () => {
		const out = ringkasVerifikasi(items, {
			'1': r({ status: 'sesuai' }), '2': r({ status: 'qty_dikoreksi', qty: '8', note: 'kurang' }), '3': r({ status: 'tidak_dimuat', note: 'Rusak' })
		});
		expect(out.selisih).toBe(2);
		expect(out.teks).toBe('3 barang: 1 sesuai, 1 jumlah beda (Thinner A: 10 → 8 L), 1 tidak ada (Kuas).');
	});
	it('semua sesuai → selisih 0', () => {
		expect(ringkasVerifikasi(items.slice(0, 1), { '1': r({ status: 'sesuai' }) })).toEqual({ teks: '1 barang: 1 sesuai.', selisih: 0 });
	});
});

describe('geserQty', () => {
	it('selalu 0 <= n < qty SJ', () => {
		expect(geserQty(10, 10, -1)).toBe(9);
		expect(geserQty(10, 9, 1)).toBe(9);
		expect(geserQty(10, 0, -1)).toBe(0);
		expect(geserQty(1, 1, -1)).toBe(0);
		expect(geserQty(2.5, 2.5, -1)).toBe(1.5);
		expect(geserQty(2.5, 2.49, 1)).toBe(2.49);
		expect(geserQty(10, Number.NaN, 1)).toBe(1);
	});
});
