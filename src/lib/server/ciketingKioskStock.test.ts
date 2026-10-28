// src/lib/server/ciketingKioskStock.test.ts
// WSK-16 — potong bahan kiosk Ciketing: bentuk PATCH Directus yang VALID, null ≠ 0, pembulatan, kompensasi.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ directus: vi.fn() }));
vi.mock('./directus', () => ({ directusServerJson: (...a: any[]) => h.directus(...a) }));
vi.mock('$lib/utils/wibDate', () => ({ todayWib: () => '2026-10-17' }));

const { ciketingKioskStockCut, casPatchStok } = await import('./ciketingKioskStock');

type Call = { path: string; method: string; body: any };
let calls: Call[] = [];
let db: { stok: number | null; ledgerFails?: boolean; races?: number };

const input = { ciketingItemId: 5, identitasBarangId: 9, quantity: 2, satuan: 'kg', projectId: 77, projectLabel: 'PO-77', operatorName: 'Budi', clientTxnId: 'tx1' };

function wire() {
	h.directus.mockImplementation(async (path: string, opts: any = {}) => {
		const call: Call = { path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null };
		calls.push(call);
		if (path.includes('ciketing_stok_ledger?filter[keterangan]')) return { data: [] };
		if (path.includes('/items/ciketing_item?filter[id][_eq]=5')) return { data: [{ id: 5, nama_barang: 'PASIR', stok_tersedia: db.stok }] };
		if (path === '/items/ciketing_item' && call.method === 'PATCH') {
			// meniru Directus: HANYA { query, data } valid (filter di URL / body polos = 400)
			if (!call.body?.query || !call.body?.data) throw new Error('Invalid payload. "data" is required.');
			if (db.races) { db.races--; db.stok = (db.stok ?? 0) + 100; return { data: [] }; }
			const cond = call.body.query.filter._and[1].stok_tersedia;
			const want = '_null' in cond ? null : cond._eq;
			if ((db.stok ?? null) !== want) return { data: [] };
			db.stok = call.body.data.stok_tersedia;
			return { data: [{ id: 5 }] };
		}
		if (path === '/items/ciketing_stok_ledger' && call.method === 'POST') { if (db.ledgerFails) throw new Error('403'); return { data: { id: 900 } }; }
		return { data: {} };
	});
}

beforeEach(() => { vi.clearAllMocks(); calls = []; db = { stok: 10 }; wire(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('casPatchStok — bentuk PATCH', () => {
	it('memakai { query:{filter}, data } dengan saldo dibulatkan 4 desimal; null memakai _null', async () => {
		db.stok = 5;
		await casPatchStok(5, 5, 3.499999999999999);
		const p = calls.find((c) => c.method === 'PATCH')!;
		expect(p.path).toBe('/items/ciketing_item'); // TIDAK ada filter di URL
		expect(p.body.query.filter._and).toEqual([{ id: { _eq: 5 } }, { stok_tersedia: { _eq: 5 } }]);
		expect(p.body.data).toEqual({ stok_tersedia: 3.5 });
		db.stok = null;
		await casPatchStok(5, null, 1);
		expect(calls.filter((c) => c.method === 'PATCH')[1].body.query.filter._and[1]).toEqual({ stok_tersedia: { _null: true } });
	});
});

describe('ciketingKioskStockCut', () => {
	it('potong 2 dari 10 → saldo 8, ledger OUT ber-asal Kiosk Potong Bahan', async () => {
		const r = await ciketingKioskStockCut(input);
		expect(r).toMatchObject({ previousStock: 10, newStock: 8, alreadyProcessed: false, ledgerId: 900 });
		expect(db.stok).toBe(8);
		const led = calls.find((c) => c.path === '/items/ciketing_stok_ledger' && c.method === 'POST')!;
		expect(led.body).toMatchObject({ tipe: 'OUT', qty: 2, asal: 'Kiosk Potong Bahan', item: 5, tanggal: '2026-10-17' });
	});
	it('desimal: 3.5 − 1.1 = 2.4 tepat (tanpa noise float)', async () => {
		db.stok = 3.5;
		const r = await ciketingKioskStockCut({ ...input, quantity: 1.1 });
		expect(r.newStock).toBe(2.4);
		expect(db.stok).toBe(2.4);
	});
	it('stok null = BELUM TERCATAT → ditolak dengan arahan ke admin (bukan "tersedia 0"); tidak menulis', async () => {
		db.stok = null;
		await expect(ciketingKioskStockCut(input)).rejects.toThrow(/belum tercatat.*stock opname/);
		expect(calls.some((c) => c.method === 'PATCH' || (c.method === 'POST'))).toBe(false);
	});
	it('stok 0 → "tidak cukup. Tersedia: 0" (0 ≠ belum tercatat); minus ditolak juga', async () => {
		db.stok = 0;
		await expect(ciketingKioskStockCut(input)).rejects.toThrow(/tidak cukup. Tersedia: 0/);
		db.stok = -8.3;
		await expect(ciketingKioskStockCut(input)).rejects.toThrow(/tidak cukup/);
	});
	it('kalah balapan CAS → baca ulang & coba lagi (tidak ada lost update)', async () => {
		db = { stok: 10, races: 2 };
		const r = await ciketingKioskStockCut(input);
		expect(db.stok).toBe(208); // 10 + 100 + 100 − 2
		expect(r.newStock).toBe(208);
	});
	it('ledger gagal → saldo dikembalikan (undo CAS)', async () => {
		db.ledgerFails = true;
		await expect(ciketingKioskStockCut(input)).rejects.toThrow('403');
		expect(db.stok).toBe(10);
	});
});
