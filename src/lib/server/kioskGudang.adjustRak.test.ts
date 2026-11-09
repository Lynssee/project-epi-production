import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ directus: vi.fn() }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => h.directus(...a) }));
vi.mock('$lib/server/kioskAlert', () => ({ triggerN8nInventoryAlert: vi.fn() }));
vi.mock('$lib/server/gateDefinitionsMode', () => ({ resolveGateMode: vi.fn() }));
vi.mock('$lib/server/opnameSesi', () => ({ itemBlindKiosk: vi.fn(async () => new Set()) }));

import { adjustOpnameRak, bolehAdjustRak, hitungAdjustmentRak } from './kioskGudang';

describe('hitungAdjustmentRak', () => {
	const hitung = (stokGlobal: number, ledgerRak: number, ledgerRakLain: number, jumlahLokasi: number, fisik: number) =>
		hitungAdjustmentRak({ stokGlobal, ledgerRak, ledgerRakLain, jumlahLokasi, fisik });

	it('satu rak: stok global & saldo rak sama-sama jadi hitungan fisik', () => {
		for (const [g, l, f] of [[12, 0, 10], [12, 0, 12], [12, 0, 15], [76.401, 0, 70], [-4, 0, 5], [10, 7, 9]]) {
			const { alokasi, selisih } = hitung(g, l, 0, 1, f);
			expect(l + alokasi + selisih).toBeCloseTo(f);
			expect(g + selisih).toBeCloseTo(f);
		}
	});

	it('hitungan cocok: tidak menambah stok global (kasus stok dobel)', () => {
		expect(hitung(12, 0, 0, 1, 12)).toEqual({ alokasi: 12, selisih: 0 });
	});

	it('beberapa rak: kekurangan tidak mengurangi stok global sebelum rak lain dihitung', () => {
		expect(hitung(20, 0, 0, 2, 5)).toEqual({ alokasi: 5, selisih: 0 });
	});

	it('beberapa rak: kelebihan di atas stok belum teralokasi menambah stok global', () => {
		expect(hitung(10, 0, 8, 2, 5)).toEqual({ alokasi: 2, selisih: 3 });
	});

	it('beberapa rak: hitungan turun dari saldo rak mengurangi stok global', () => {
		expect(hitung(20, 5, 0, 2, 3)).toEqual({ alokasi: 0, selisih: -2 });
	});

	it('kiriman ulang setelah sukses tidak mengubah apa pun', () => {
		expect(hitung(10, 10, 0, 1, 10)).toEqual({ alokasi: 0, selisih: 0 });
	});
});

describe('adjustOpnameRak', () => {
	const input = { gudang_id: 91, placement_id: 5, hitung_fisik: 10, catatan: '', client_txn_id: 'adj-1', karyawan_id: 325, karyawan_nama: 'Uji' };
	let stok: string;
	let txRak: any[];
	const panggilan = (m: string, p: string) => h.directus.mock.calls.filter(([path, o]) => o?.method === m && String(path).startsWith(p));

	beforeEach(() => {
		stok = '12';
		txRak = [];
		h.directus.mockReset();
		h.directus.mockImplementation(async (path: string, opt?: any) => {
			if (opt?.method === 'PATCH') {
				if (path === '/items/identitas_barang') {
					stok = JSON.parse(opt.body).data.stok_tersedia;
					return { data: [{ id: 15690 }] };
				}
				return { data: { stok_tersedia: stok } };
			}
			if (opt?.method === 'POST') return { data: { id: 1, reference_no: 'SL-1' } };
			if (path.startsWith('/items/gudang_item_placement?filter[id]')) return { data: [{ gudang_id: 91, identitas_barang_id: 15690 }] };
			if (path.startsWith('/items/gudang_item_placement')) return { data: [{ gudang_id: 91 }] };
			if (path.startsWith('/items/gudang?filter[id][_eq]=91')) return { data: [{ id: 91, nama_gudang: 'RAK A8', parent_gudang_id: 147 }] };
			if (path.startsWith('/items/gudang?filter[id][_eq]=147')) return { data: [{ id: 147, nama_gudang: 'Rak A', parent_gudang_id: 1 }] };
			if (path.startsWith('/items/gudang?filter[id][_eq]=1&')) return { data: [{ id: 1, nama_gudang: 'Bojongkulur', parent_gudang_id: null }] };
			if (path.startsWith('/items/identitas_barang?')) return { data: [{ id: 15690, stok_tersedia: stok }] };
			if (path.startsWith('/items/stock_transactions?filter[gudang_id]')) return { data: txRak };
			return { data: [] };
		});
	});

	it('stok 12 dihitung 10: rak terisi tanpa dobel, stok global jadi 10', async () => {
		const hasil = await adjustOpnameRak(input);

		expect(hasil).toMatchObject({ ok: true, alokasi: 12, selisih: -2, di_rak_baru: 10, stok_tersedia_baru: 10 });
		const [alokasi] = panggilan('POST', '/items/stock_transactions')[0].slice(1).map((o: any) => JSON.parse(o.body));
		expect(alokasi.map((r: any) => [r.gudang_id, r.category_transaction, r.previous_stock === r.new_stock])).toEqual([
			[91, 'TRANSFER-RAK-IN', true],
			[1, 'TRANSFER-RAK-OUT', true]
		]);
		const adj = JSON.parse(panggilan('POST', '/items/stock_transactions')[1][1].body);
		expect(adj).toMatchObject({ category_transaction: 'OPNAME_ADJ', transaction_type: 'OUT', quantity: 2, gudang_id: 91, status: 'published' });
		expect(JSON.parse(panggilan('PATCH', '/items/identitas_barang/15690')[0][1].body).last_stock_update).toBeTruthy();
	});

	it('hitungan sama dengan stok: tidak ada OPNAME_ADJ, stok tetap, waktu update tercatat', async () => {
		const hasil = await adjustOpnameRak({ ...input, hitung_fisik: 12 });

		expect(hasil).toMatchObject({ ok: true, status: 'no_change', stok_tersedia_baru: 12 });
		expect(panggilan('POST', '/items/stock_transactions')).toHaveLength(1);
		expect(panggilan('PATCH', '/items/identitas_barang/15690')).toHaveLength(1);
	});

	it('kiriman ulang saat saldo rak sudah sesuai: tidak menulis transaksi lagi', async () => {
		stok = '10';
		txRak = [{ gudang_id: 91, category_transaction: 'TRANSFER-RAK-IN', quantity: 10, previous_stock: 10, new_stock: 10 }];

		expect(await adjustOpnameRak(input)).toMatchObject({ ok: true, alokasi: 0, selisih: 0 });
		expect(panggilan('POST', '/items/stock_transactions')).toHaveLength(0);
	});

	it('penempatan milik rak lain ditolak sebelum menulis', async () => {
		expect(await adjustOpnameRak({ ...input, gudang_id: 92 })).toMatchObject({ ok: false, status: 404 });
		expect(panggilan('POST', '/items/stock_transactions')).toHaveLength(0);
	});

	it('gagal baca transaksi: berhenti, jangan anggap saldo 0', async () => {
		const asli = h.directus.getMockImplementation()!;
		h.directus.mockImplementation(async (path: string, opt?: any) => {
			if (path.startsWith('/items/stock_transactions?filter[gudang_id]')) throw new Error('directus down');
			return asli(path, opt);
		});

		expect(await adjustOpnameRak(input)).toMatchObject({ ok: false, status: 503 });
		expect(panggilan('POST', '/items/stock_transactions')).toHaveLength(0);
		expect(panggilan('PATCH', '/items/identitas_barang')).toHaveLength(0);
	});
});

describe('bolehAdjustRak', () => {
	beforeEach(() => h.directus.mockReset() && undefined);
	const rak = { parent_gudang_id: 147, pic_karyawan_ids: [133] };
	const data = (akses: string[] | null, picInduk: number[]) =>
		h.directus.mockImplementation(async (p: string) => (p.startsWith('/items/karyawan') ? { data: [{ kiosk_menu_access: akses }] } : { data: [{ pic_karyawan_ids: picInduk }] }));

	it('PIC rak boleh tanpa query tambahan', async () => {
		expect(await bolehAdjustRak(133, rak)).toBe(true);
		expect(h.directus).not.toHaveBeenCalled();
	});
	it('punya akses menu Hitung Stok boleh', async () => {
		data(['gudang_opname'], []);
		expect(await bolehAdjustRak(325, rak)).toBe(true);
	});
	it('PIC rak induk boleh', async () => {
		data([], [325]);
		expect(await bolehAdjustRak(325, rak)).toBe(true);
	});
	it('selain itu ditolak', async () => {
		data(['gudang_stok'], [134]);
		expect(await bolehAdjustRak(325, rak)).toBe(false);
	});
});
