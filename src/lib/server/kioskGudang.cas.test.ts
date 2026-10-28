// Bentuk PATCH bersyarat (CAS) kiosk gudang: stok_tersedia (varchar) + packing_list_items.qty_delivered.
// Bentuk lama `PATCH ?filter[...]` + body polos DITOLAK Directus prod (400 "data is required", 17 Okt 2026) —
// mock di sini meniru penolakan itu (assertBatchPatch) supaya regresi tertangkap.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertBatchPatch } from './directusCasTestkit';

const h = vi.hoisted(() => ({ directus: vi.fn() }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => h.directus(...a) }));
vi.mock('$lib/server/kioskAlert', () => ({ triggerN8nInventoryAlert: vi.fn() }));
vi.mock('$lib/server/kioskStok', () => ({ fetchLedgerQtyForGudang: vi.fn() }));

const { submitPickKiosk } = await import('./kioskGudang');

type Call = { path: string; method: string; body: any };
let calls: Call[] = [];
let db: { stokRaw: string | null; qtyDelivered: number; qtyRequired: number; txFails?: boolean; qtyRaces?: number };

const pick = { packing_list_id: 1, packing_list_item_id: 3, item_id: 9, quantity: 1, client_txn_id: 'tx-1', karyawan_id: 7, karyawan_nama: 'Budi' };

function wire() {
	h.directus.mockImplementation(async (path: string, opts: any = {}) => {
		const method = opts.method || 'GET';
		calls.push({ path, method, body: opts.body ? JSON.parse(opts.body) : null });
		if (method === 'GET') {
			if (path.startsWith('/items/stock_transactions?')) return { data: [] };
			if (path.startsWith('/items/identitas_barang?filter[id][_eq]=9')) return { data: [{ id: 9, stok_tersedia: db.stokRaw }] };
			if (path.startsWith('/items/packing_list_items?filter[id][_eq]=3')) return { data: [{ id: 3, qty_required: db.qtyRequired, qty_delivered: db.qtyDelivered }] };
			if (path.startsWith('/items/packing_list_items?')) return { data: [{ id: 3, qty_required: db.qtyRequired, qty_delivered: db.qtyDelivered }] };
			return { data: [] };
		}
		if (method === 'PATCH' && path === '/items/identitas_barang') {
			const { filter, data } = assertBatchPatch(path, opts.body);
			const cond = (filter as any)._and[1].stok_tersedia;
			const want = '_null' in cond ? null : cond._eq;
			if (db.stokRaw !== want) return { data: [] };
			db.stokRaw = data.stok_tersedia;
			return { data: [{ id: 9 }] };
		}
		if (method === 'PATCH' && path === '/items/packing_list_items') {
			const { filter, data } = assertBatchPatch(path, opts.body);
			if (db.qtyRaces) {
				db.qtyRaces--;
				db.qtyDelivered += 1; // pick lain masuk duluan
				return { data: [] };
			}
			const want = (filter as any)._and[1].qty_delivered._eq;
			if (db.qtyDelivered !== want) return { data: [] };
			db.qtyDelivered = data.qty_delivered;
			return { data: [{ id: 3 }] };
		}
		if (method === 'PATCH') return { data: {} }; // /items/packing_list/<id> (rekap progres)
		if (method === 'POST' && path === '/items/stock_transactions') {
			if (db.txFails) throw new Error('boom');
			return { data: { id: 55, reference_no: 'SL-X' } };
		}
		return { data: {} };
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	calls = [];
	db = { stokRaw: '4.0', qtyDelivered: 0, qtyRequired: 5 };
	wire();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

const patches = (path: string) => calls.filter((c) => c.method === 'PATCH' && c.path === path);

describe('submitPickKiosk — bentuk PATCH CAS', () => {
	it('qty_delivered & stok_tersedia memakai { query:{filter}, data }, tanpa filter di URL', async () => {
		const r = await submitPickKiosk(pick);
		expect(r).toMatchObject({ ok: true, qty_delivered_baru: 1, reference_no: 'SL-X' });
		const qty = patches('/items/packing_list_items')[0];
		expect(qty.body.query.filter._and).toEqual([{ id: { _eq: 3 } }, { qty_delivered: { _eq: 0 } }]);
		expect(qty.body.data).toEqual({ qty_delivered: 1 });
		const stok = patches('/items/identitas_barang')[0];
		// nilai MENTAH varchar ("4.0") dipakai apa adanya sebagai pembanding; saldo baru dikanonikkan
		expect(stok.body.query.filter._and).toEqual([{ id: { _eq: 9 } }, { stok_tersedia: { _eq: '4.0' } }]);
		expect(stok.body.data).toEqual({ stok_tersedia: '3' });
		expect(calls.some((c) => c.method === 'PATCH' && /[?&]filter/.test(c.path))).toBe(false);
	});

	it('stok_tersedia null → pembanding _null', async () => {
		db.stokRaw = null;
		await submitPickKiosk(pick);
		expect(patches('/items/identitas_barang')[0].body.query.filter._and[1]).toEqual({ stok_tersedia: { _null: true } });
	});

	it('kalah balapan qty_delivered → retry dengan nilai terbaru (CAS), bukan menimpa', async () => {
		db.qtyRaces = 1;
		const r = await submitPickKiosk(pick);
		expect(r).toMatchObject({ ok: true, qty_delivered_baru: 2 });
		expect(db.qtyDelivered).toBe(2);
		const qty = patches('/items/packing_list_items');
		expect(qty).toHaveLength(2);
		expect(qty[1].body.query.filter._and[1]).toEqual({ qty_delivered: { _eq: 1 } });
	});

	it('stock_transactions gagal → stok di-undo & qty_delivered dikompensasi lewat CAS yang valid', async () => {
		db.txFails = true;
		const r = await submitPickKiosk(pick);
		expect(r).toMatchObject({ ok: false, status: 502 });
		expect(db.qtyDelivered).toBe(0);
		expect(db.stokRaw).toBe('4'); // undo menulis nilai kanonik
	});
});
