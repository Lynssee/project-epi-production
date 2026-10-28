// RSM-05 — form retur membaca project_stock_balance (sumber tunggal), diperkaya terpisah; cadangan project_expenses.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Cmd = { c: string; q: any; agg?: boolean };
let db: Record<string, any[] | Error> = {};

vi.mock('@directus/sdk', () => ({
	readItems: (c: string, q: any) => ({ c, q }),
	readItem: (c: string, id: any, q: any) => ({ c, id, q }),
	updateItem: () => ({}),
	createItem: () => ({}),
	aggregate: (c: string, q: any) => ({ c, q, agg: true })
}));
vi.mock('./directus', () => ({
	default: {
		request: vi.fn(async (cmd: Cmd) => {
			const r = db[cmd.c];
			if (r instanceof Error) throw r;
			return r ?? [];
		})
	},
	handleDirectusError: vi.fn()
}));
vi.mock('./secureDirectus', () => ({ getIdToken: vi.fn() }));
vi.mock('./stockLapangan', () => ({ uploadEvidencePhoto: vi.fn() }));
vi.mock('./projectSettings', () => ({ loadProjectSettings: vi.fn(), getProjectSetting: vi.fn() }));

const { getProjectInventoryTerpadu } = await import('./packingList');

const exp = (o: any = {}) => ({ id: 900, project_id: 1, expense_type: 'supplier', material_name: 'HELM', qty: 10, unit: 'Pcs', unit_price: 100, identitas_barang_id: 21866, ...o });

beforeEach(() => {
	db = {};
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('getProjectInventoryTerpadu', () => {
	it('sumber = saldo: baris dari balance, kunci identitas_barang, diperkaya biaya + ledger', async () => {
		db.project_expenses = [exp()];
		db.project_stock_balance = [{ id: 1, item_id: 21866, qty_received: 10, qty_used: 2, qty_on_hand: 6 }, { id: 2, item_id: 5, qty_received: 3, qty_used: 3, qty_on_hand: 0 }];
		db.identitas_barang = [{ id: 21866, nama_barang_lengkap: 'helm safety', satuan: 'PCS' }];
		db.project_stock_ledger = [{ item_id: 21866, transaction_type: 'OUT-RETURN', sum: { quantity: -2 } }];
		const r = await getProjectInventoryTerpadu(1);
		expect(r.sumber).toBe('saldo');
		expect(r.items).toHaveLength(1); // saldo 0 tidak ikut
		expect(r.items[0]).toMatchObject({ id: 21866, identitas_barang_id: 21866, material_name: 'helm safety', unit: 'PCS', qty: 10, qty_used: 2, qty_remaining: 6, diretur: 2, hilang: 0, expense_id: 900, unit_price: 100 });
	});

	it('barang ada di saldo tapi tanpa catatan biaya tetap tampil (kasus #956: ledger tanpa expenses)', async () => {
		db.project_expenses = [];
		db.project_stock_balance = [{ id: 1, item_id: 77, qty_received: 4, qty_used: 0, qty_on_hand: 4 }];
		db.identitas_barang = [{ id: 77, nama_barang_lengkap: 'TANGGA', satuan: 'Pcs' }];
		const r = await getProjectInventoryTerpadu(956);
		expect(r.items).toHaveLength(1);
		expect(r.items[0]).toMatchObject({ id: 77, material_name: 'TANGGA', expense_id: null, expense_type: 'supplier' });
	});

	it('jasa / operasional dikecualikan (setelan default)', async () => {
		db.project_expenses = [exp({ id: 1, identitas_barang_id: 10, expense_type: 'jasa' }), exp({ id: 2, identitas_barang_id: 11, expense_type: 'supplier' })];
		db.project_stock_balance = [{ item_id: 10, qty_received: 1, qty_used: 0, qty_on_hand: 1 }, { item_id: 11, qty_received: 1, qty_used: 0, qty_on_hand: 1 }];
		db.identitas_barang = [{ id: 10, nama_barang_lengkap: 'Jasa pasang', satuan: 'Ls' }, { id: 11, nama_barang_lengkap: 'Cat', satuan: 'Kg' }];
		const r = await getProjectInventoryTerpadu(1);
		expect(r.items.map((i: any) => i.id)).toEqual([11]);
	});

	it('saldo kosong tapi ada biaya → cadangan project_expenses; keduanya kosong → tanpaCatatanKirim', async () => {
		db.project_expenses = [exp()];
		db.project_stock_balance = [];
		const a = await getProjectInventoryTerpadu(1);
		expect(a).toMatchObject({ sumber: 'biaya', tanpaCatatanKirim: false });
		expect(a.items).toHaveLength(1);
		db.project_expenses = [];
		const b = await getProjectInventoryTerpadu(965);
		expect(b).toMatchObject({ sumber: 'biaya', tanpaCatatanKirim: true, items: [] });
	});

	it('balance tak terbaca → cadangan, bukan crash; agregat ledger gagal → rincian 0 tanpa menggagalkan', async () => {
		db.project_expenses = [exp()];
		db.project_stock_balance = new Error('403');
		expect((await getProjectInventoryTerpadu(1)).sumber).toBe('biaya');
		db.project_stock_balance = [{ item_id: 21866, qty_received: 10, qty_used: 0, qty_on_hand: 10 }];
		db.identitas_barang = [{ id: 21866, nama_barang_lengkap: 'helm', satuan: 'Pcs' }];
		db.project_stock_ledger = new Error('403');
		const r = await getProjectInventoryTerpadu(1);
		expect(r.sumber).toBe('saldo');
		expect(r.items[0]).toMatchObject({ diretur: 0, hilang: 0 });
	});
});
