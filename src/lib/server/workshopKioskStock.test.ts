// src/lib/server/workshopKioskStock.test.ts
// Stok kiosk terpadu Ciketing & Balaraja (Fase 7 Unifikasi Workshop).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ directus: vi.fn(), ckt: vi.fn() }));
vi.mock('./directus', () => ({ directusServerJson: (...a: any[]) => h.directus(...a) }));
vi.mock('./ciketingKioskStock', () => ({ ciketingKioskStockCut: (...a: any[]) => h.ckt(...a) }));
vi.mock('$lib/utils/wibDate', () => ({ todayWib: () => '2026-10-10' }));

const { balancesFromAggregate, listKioskStock, getKioskItemBalance, workshopKioskStockCut } = await import('./workshopKioskStock');
const { requireKioskProfile, isWorkshopKey } = await import('$lib/kiosk/workshopKiosk');

type Call = { path: string; method: string; body: any };
let calls: Call[] = [];

/** Router tiruan Directus: tiap handler dicocokkan lewat potongan path. */
function route(handlers: Array<[string, (c: Call) => any]>) {
	h.directus.mockImplementation(async (path: string, opts: any = {}) => {
		const call: Call = { path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null };
		calls.push(call);
		for (const [needle, fn] of handlers) if (path.includes(needle)) return fn(call);
		return { data: [] };
	});
}

const agg = (rows: Array<[number, string, number]>) => ({ data: rows.map(([item, tipe, q]) => ({ item, tipe, sum: { qty: String(q) } })) });
const input = { itemId: 5, identitasBarangId: 9, quantity: 3, satuan: 'kg', projectId: 77, projectLabel: 'PO-77', operatorName: 'Budi', clientTxnId: 'tx1' };

beforeEach(() => { vi.clearAllMocks(); calls = []; });

describe('profil kiosk', () => {
	it('hanya ciketing/balaraja; selain itu melempar', () => {
		expect(isWorkshopKey('balaraja')).toBe(true);
		expect(isWorkshopKey('x')).toBe(false);
		expect(requireKioskProfile('balaraja').stockColumn).toBe(false);
		expect(requireKioskProfile('ciketing').stockColumn).toBe(true);
		expect(() => requireKioskProfile('__proto__')).toThrow(/tidak dikenal/);
	});
});

describe('balancesFromAggregate', () => {
	it('IN − OUT per item, abaikan tipe lain & baris tanpa item', () => {
		const m = balancesFromAggregate([
			{ item: 1, tipe: 'IN', sum: { qty: '10' } }, { item: 1, tipe: 'OUT', sum: { qty: 4 } },
			{ item: { id: 2 }, tipe: 'IN', sum: { qty: 5 } }, { item: 3, tipe: 'ADJ', sum: { qty: 99 } },
			{ item: null, tipe: 'IN', sum: { qty: 1 } }, { item: 4, tipe: 'IN' }
		] as any);
		expect(m.get(1)).toBe(6);
		expect(m.get(2)).toBe(5);
		expect(m.get(3)).toBe(0);
		expect(m.get(4)).toBe(0);
	});
});

describe('listKioskStock', () => {
	it('ciketing: baca kolom stok_tersedia', async () => {
		route([['ciketing_item', () => ({ data: [{ id: 1, nama_barang: 'Pasir', kode: 'P1', satuan_default: 'kg', stok_tersedia: '12', stok_min: 5 }] })]]);
		const rows = await listKioskStock('ciketing');
		expect(rows).toEqual([{ id: 1, namaBarang: 'Pasir', kode: 'P1', satuan: 'kg', stokTersedia: 12, stokMin: 5 }]);
		expect(calls[0].path).toContain('stok_tersedia');
	});

	it('balaraja: TIDAK meminta stok_tersedia (anti-403); saldo dari agregat ledger', async () => {
		route([
			['balaraja_item', () => ({ data: [{ id: 1, nama_barang: 'Cat', kode: null, satuan_default: 'L', stok_min: 10 }, { id: 2, nama_barang: 'Thinner', satuan_default: 'L' }] })],
			['balaraja_stok_ledger', () => agg([[1, 'IN', 30], [1, 'OUT', 25]])]
		]);
		const rows = await listKioskStock('balaraja');
		expect(calls.find((c) => c.path.includes('balaraja_item'))!.path).not.toContain('stok_tersedia');
		expect(rows.map((r) => [r.id, r.stokTersedia, r.stokMin])).toEqual([[1, 5, 10], [2, null, 0]]); // item 2 tanpa baris ledger = BELUM TERCATAT (null), bukan 0
	});

	it('WSK-16: ciketing null → belum tercatat (null), 0 tetap 0, minus tampil apa adanya, pembulatan 4 desimal', async () => {
		route([['ciketing_item', () => ({ data: [
			{ id: 1, nama_barang: 'A', stok_tersedia: null, stok_min: 0 },
			{ id: 2, nama_barang: 'B', stok_tersedia: 0, stok_min: 0 },
			{ id: 3, nama_barang: 'C', stok_tersedia: -8.3, stok_min: 0 },
			{ id: 4, nama_barang: 'D', stok_tersedia: 3.499999999999999, stok_min: 0 }
		] })]]);
		const rows = await listKioskStock('ciketing');
		expect(rows.map((r) => r.stokTersedia)).toEqual([null, 0, -8.3, 3.5]);
	});

	it('Directus gagal → melempar (bukan daftar kosong)', async () => {
		h.directus.mockRejectedValue(new Error('403'));
		await expect(listKioskStock('balaraja')).rejects.toThrow('403');
	});
});

describe('workshopKioskStockCut', () => {
	it('ciketing: didelegasikan ke CAS Ciketing dengan field yang dipetakan', async () => {
		h.ckt.mockResolvedValue({ ledgerId: 1, previousStock: 10, newStock: 7, alreadyProcessed: false });
		const r = await workshopKioskStockCut('ciketing', input);
		expect(r.newStock).toBe(7);
		expect(h.ckt).toHaveBeenCalledWith(expect.objectContaining({ ciketingItemId: 5, identitasBarangId: 9, quantity: 3, clientTxnId: 'tx1' }));
		expect(h.directus).not.toHaveBeenCalled();
	});

	it('balaraja: sukses → tulis ledger OUT tanpa identitas_barang_id; saldo turun', async () => {
		let ledgerWritten = false;
		route([
			['filter[keterangan]', () => ({ data: [] })],
			['aggregate', () => agg(ledgerWritten ? [[5, 'IN', 10], [5, 'OUT', 3]] : [[5, 'IN', 10]])],
			['/items/balaraja_stok_ledger', (c) => { if (c.method === 'POST') { ledgerWritten = true; return { data: { id: 321 } }; } return { data: [] }; }]
		]);
		const r = await workshopKioskStockCut('balaraja', input);
		expect(r).toEqual({ ledgerId: 321, previousStock: 10, newStock: 7, alreadyProcessed: false });
		const post = calls.find((c) => c.method === 'POST')!;
		expect(post.path).toBe('/items/balaraja_stok_ledger');
		expect(post.body).toMatchObject({ tanggal: '2026-10-10', item: 5, tipe: 'OUT', qty: 3, satuan: 'kg', asal: 'Kiosk Potong Bahan', project: 77, pic: 'Budi' });
		expect(post.body).not.toHaveProperty('identitas_barang_id');
		expect(post.body.keterangan).toContain('#tx1');
	});

	it('balaraja: stok kurang → ditolak, tidak menulis apa pun', async () => {
		route([
			['filter[keterangan]', () => ({ data: [] })],
			['aggregate', () => agg([[5, 'IN', 2]])],
			['fields=nama_barang', () => ({ data: [{ nama_barang: 'Cat' }] })]
		]);
		await expect(workshopKioskStockCut('balaraja', input)).rejects.toThrow(/tidak cukup/);
		expect(calls.some((c) => c.method === 'POST')).toBe(false);
	});

	it('balaraja: retry dengan clientTxnId sama → alreadyProcessed, tidak menulis ganda', async () => {
		route([
			['filter[keterangan]', () => ({ data: [{ id: 321 }] })],
			['aggregate', () => agg([[5, 'IN', 10], [5, 'OUT', 3]])]
		]);
		const r = await workshopKioskStockCut('balaraja', input);
		expect(r).toMatchObject({ ledgerId: 321, alreadyProcessed: true, newStock: 7, previousStock: 10 });
		expect(calls.some((c) => c.method === 'POST')).toBe(false);
	});

	it('balaraja: potong bersamaan membuat saldo negatif → baris dibatalkan & operator diminta ulang', async () => {
		route([
			['filter[keterangan]', () => ({ data: [] })],
			// cek awal: 3 (cukup); setelah tulis: −1 karena transaksi lain ikut masuk
			['aggregate', (() => { let n = 0; return () => (++n === 1 ? agg([[5, 'IN', 3]]) : agg([[5, 'IN', 3], [5, 'OUT', 4]])); })()],
			['/items/balaraja_stok_ledger', (c) => (c.method === 'POST' ? { data: { id: 900 } } : { data: [] })]
		]);
		await expect(workshopKioskStockCut('balaraja', { ...input, quantity: 3 })).rejects.toThrow(/transaksi bersamaan/);
		const del = calls.find((c) => c.method === 'DELETE');
		expect(del?.path).toBe('/items/balaraja_stok_ledger/900');
	});

	it('balaraja: pembatalan gagal → alert critical tercatat', async () => {
		route([
			['filter[keterangan]', () => ({ data: [] })],
			['aggregate', (() => { let n = 0; return () => (++n === 1 ? agg([[5, 'IN', 3]]) : agg([[5, 'IN', 3], [5, 'OUT', 4]])); })()],
			['/items/balaraja_stok_ledger/900', () => { throw new Error('boom'); }],
			['/items/balaraja_stok_ledger', (c) => (c.method === 'POST' ? { data: { id: 900 } } : { data: [] })]
		]);
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(workshopKioskStockCut('balaraja', input)).rejects.toThrow(/transaksi bersamaan/);
		const alert = calls.find((c) => c.path === '/items/automation_alerts');
		expect(alert?.body).toMatchObject({ source: 'kiosk_balaraja_stock_write', severity: 'critical' });
		spy.mockRestore();
	});

	it('validasi input: qty/itemId/projectId/clientTxnId wajib', async () => {
		await expect(workshopKioskStockCut('balaraja', { ...input, quantity: 0 })).rejects.toThrow(/lebih dari 0/);
		await expect(workshopKioskStockCut('balaraja', { ...input, itemId: 0 })).rejects.toThrow(/Item Balaraja/);
		await expect(workshopKioskStockCut('balaraja', { ...input, projectId: 0 })).rejects.toThrow(/SPK/);
		await expect(workshopKioskStockCut('balaraja', { ...input, clientTxnId: '' })).rejects.toThrow(/clientTxnId/);
	});
});

describe('getKioskItemBalance', () => {
	it('balaraja: hanya satu item (filter) dari agregat', async () => {
		route([['aggregate', () => agg([[5, 'IN', 8], [5, 'OUT', 2]])]]);
		expect(await getKioskItemBalance('balaraja', 5)).toBe(6);
		expect(calls[0].path).toContain('filter[item][_eq]=5');
	});
});
