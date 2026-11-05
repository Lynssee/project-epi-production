import { describe, it, expect } from 'vitest';
import { drafKeBaris, drafMasihAda, gabungMaterialUsed, parseQty, susunBarang, tandaDraf } from './kioskPemakaian';

describe('parseQty', () => {
	it('menerima koma/titik, maks 3 desimal, harus > 0', () => {
		expect(parseQty('5')).toBe(5);
		expect(parseQty('1,5')).toBe(1.5);
		expect(parseQty(' 0.125 ')).toBe(0.125);
		expect(parseQty('0')).toBeNull();
		expect(parseQty('-1')).toBeNull();
		expect(parseQty('1.2345')).toBeNull();
		expect(parseQty('abc')).toBeNull();
		expect(parseQty('1e3')).toBeNull();
		expect(parseQty('')).toBeNull();
		expect(parseQty(null)).toBeNull();
		expect(parseQty('1000001')).toBeNull();
	});
});

describe('susunBarang (sama dengan daftar material di Laporan Harian)', () => {
	it('hanya yang sisa > 0, qty_remaining kosong → qty - qty_used, nama cadangan, urut nama', () => {
		const r = susunBarang([
			{ id: 1, material_name: 'Thinner', unit: 'liter', qty: '100', qty_used: '30', qty_remaining: '70', identitas_barang_id: 5 },
			{ id: 2, description: 'Sarung tangan', unit: 'pasang', qty: '10', qty_used: '4', qty_remaining: null },
			{ id: 3, material_name: 'Habis', unit: 'kg', qty: '5', qty_used: '5', qty_remaining: '0' },
			{ id: 4, material_name: 'Minus', unit: 'kg', qty: '5', qty_used: '9', qty_remaining: null },
			{ id: 5, unit: 'kg', qty: '2', qty_used: '0', qty_remaining: '2', identitas_barang_id: { id: 9 } },
			null as any
		]);
		expect(r.map((b) => b.expense_id)).toEqual([5, 2, 1]); // 'Item Tanpa Nama' < 'Sarung tangan' < 'Thinner'
		expect(r.find((b) => b.expense_id === 2)).toMatchObject({ nama: 'Sarung tangan', sisa: 6, identitas_barang_id: null });
		expect(r.find((b) => b.expense_id === 1)).toMatchObject({ sisa: 70, identitas_barang_id: 5 });
		expect(r.find((b) => b.expense_id === 5)).toMatchObject({ nama: 'Item Tanpa Nama', identitas_barang_id: 9 });
	});
	it('null/undefined aman', () => {
		expect(susunBarang(null)).toEqual([]);
		expect(susunBarang(undefined)).toEqual([]);
	});
});

describe('impor ke material_used', () => {
	const d = { id: 12, manpower_nama: 'Agus', expense_id: 77, identitas_barang_id: 5, nama_barang: 'Thinner', satuan: 'liter', qty: 2.5, catatan: 'untuk  primer' };
	it('drafKeBaris: bentuk baris form, bukan manual, dengan penanda draf', () => {
		expect(drafKeBaris(d)).toEqual({
			type: 'Thinner', amount: 2.5, unit: 'liter', notes: '[kiosk#12] Agus: untuk primer',
			expense_id: '77', identitas_barang_id: 5, is_manual: false
		});
		expect(drafKeBaris({ ...d, satuan: null, catatan: null, identitas_barang_id: null }).unit).toBe('kg');
	});
	it('gabungMaterialUsed: membuang baris kosong bawaan, menjaga baris leader, impor ulang tidak menggandakan', () => {
		const kosong = { type: '', amount: 0, unit: 'kg', notes: '', expense_id: '', identitas_barang_id: null, is_manual: false };
		const leader = { type: 'Primer', amount: 3, unit: 'kg', notes: '', expense_id: '8', identitas_barang_id: null, is_manual: false };
		const a = gabungMaterialUsed([kosong], [d]);
		expect(a).toHaveLength(1);
		const b = gabungMaterialUsed([leader, kosong], [d]);
		expect(b.map((x) => x.type)).toEqual(['Primer', 'Thinner']);
		const c = gabungMaterialUsed(b, [d]);
		expect(c).toHaveLength(2);
		expect(gabungMaterialUsed(null, [])).toEqual([]);
	});
	it('drafMasihAda: hanya draf yang barisnya masih ada saat disimpan', () => {
		const tersimpan = [{ notes: `${tandaDraf(12)} Agus` }, { notes: '' }, { notes: null }, { notes: `${tandaDraf(120)} lain` }];
		expect(drafMasihAda([12, 13], tersimpan)).toEqual([12]);
		expect(drafMasihAda([1], tersimpan)).toEqual([]); // "[kiosk#1]" tidak cocok "[kiosk#12]"
		expect(drafMasihAda([12], null)).toEqual([]);
	});
});
