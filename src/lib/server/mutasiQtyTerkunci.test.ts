// RSM-13 §4.2 — qty terkunci mutasi + penolakan retur yang melebihi saldo − terkunci.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let heads: any[];
let items: any[];
let balance: any[];
let failMutasi = false;
vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn(async (path: string) => {
		if (path.startsWith('/items/mutasi_barang?')) {
			if (failMutasi) throw new Error('403 FORBIDDEN');
			return { data: heads };
		}
		if (path.startsWith('/items/mutasi_barang_items')) return { data: items };
		if (path.startsWith('/items/project_stock_balance')) return { data: balance };
		return { data: [] };
	})
}));
vi.mock('$lib/server/gateEnforcement', () => ({ getFieldGateMode: vi.fn(async () => 'shadow') }));
vi.mock('$lib/server/gates/gateAudit', () => ({ writeGateAudit: vi.fn(async () => {}) }));
vi.mock('$lib/server/returGudangServer', () => ({ createReturDocument: vi.fn() }));

const { getQtyTerkunciMutasi, saldoTersedia, STATUS_KUNCI_QTY } = await import('./mutasiQtyTerkunci');
const { tolakBilaQtyTerkunciMutasi } = await import('./returSubmit');

const item = (o: any = {}) => ({ material_name: 'Frame', qty_returned: 5, unit: 'Pcs', condition: 'ok', item_id: 10, ...o });

beforeEach(() => {
	heads = [{ id: 1 }, { id: 2 }];
	items = [{ mutasi_id: 1, item_id: 10, qty: 4 }, { mutasi_id: 2, item_id: 10, qty: 1 }, { mutasi_id: 2, item_id: 11, qty: 2 }];
	balance = [{ item_id: 10, qty_on_hand: 8 }];
	failMutasi = false;
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getQtyTerkunciMutasi', () => {
	it('menjumlah per barang dari mutasi diajukan/disetujui saja (yang sudah berangkat tidak dikunci lagi)', async () => {
		expect([...STATUS_KUNCI_QTY]).toEqual(['diajukan', 'disetujui_tujuan']);
		const m = await getQtyTerkunciMutasi(1);
		expect(m.get(10)).toBe(5);
		expect(m.get(11)).toBe(2);
	});
	it('koleksi belum ada → kosong dan error dicatat jelas', async () => {
		failMutasi = true;
		expect((await getQtyTerkunciMutasi(1)).size).toBe(0);
		expect(console.error).toHaveBeenCalled();
	});
	it('tanpa mutasi aktif → kosong tanpa query baris', async () => {
		heads = [];
		expect((await getQtyTerkunciMutasi(1)).size).toBe(0);
	});
});

describe('saldoTersedia', () => {
	it('saldo − terkunci, tidak negatif, aman untuk nilai kosong', () => {
		expect(saldoTersedia(8, 5)).toBe(3);
		expect(saldoTersedia(2, 5)).toBe(0);
		expect(saldoTersedia(NaN as any, undefined as any)).toBe(0);
	});
});

describe('tolakBilaQtyTerkunciMutasi (retur)', () => {
	it('retur melebihi saldo − terkunci → 409 RTN_QTY_TERKUNCI dengan rincian', async () => {
		// saldo 8, terkunci 5 → tersedia 3; retur 5 ditolak
		await expect(tolakBilaQtyTerkunciMutasi(1, [item()])).rejects.toMatchObject({ status: 409, code: 'RTN_QTY_TERKUNCI' });
	});
	it('retur dalam batas tersedia lolos; barang lain yang tidak terkunci tidak diperiksa', async () => {
		await expect(tolakBilaQtyTerkunciMutasi(1, [item({ qty_returned: 3 })])).resolves.toBeUndefined();
		await expect(tolakBilaQtyTerkunciMutasi(1, [item({ item_id: 99, qty_returned: 500 })])).resolves.toBeUndefined();
	});
	it('tanpa mutasi aktif → lolos (tidak mengubah perilaku lama)', async () => {
		heads = [];
		await expect(tolakBilaQtyTerkunciMutasi(1, [item({ qty_returned: 500 })])).resolves.toBeUndefined();
	});
});
