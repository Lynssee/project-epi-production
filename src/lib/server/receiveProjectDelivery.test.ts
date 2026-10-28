// RSM-11 — satu titik penerimaan proyek: idempoten per baris, tanpa IN-RECEIPT ganda.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = { path: string; method: string; body: any };
const calls: Call[] = [];
let expenses: any[] = [];
let ledgerLama: any[] = [];
let ledgerGagal = false;

vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn(async (path: string, opts: any = {}) => {
		const method = opts?.method || 'GET';
		const body = opts?.body ? JSON.parse(opts.body) : null;
		calls.push({ path, method, body });
		if (method === 'GET') {
			if (path.startsWith('/items/surat_jalan/')) return { data: { id: 7, nomor_sj: 'SJ/261024/001', project_id: 5 } };
			if (path.startsWith('/items/project_expenses?')) return { data: expenses };
			if (path.startsWith('/items/project_stock_ledger?')) {
				if (ledgerGagal) throw new Error('403');
				return { data: ledgerLama };
			}
		}
		return { data: {} };
	})
}));
const append = vi.fn(async (p: any) => ({ entry: { id: 1, ...p }, deduped: false }));
const rebuild = vi.fn(async () => {});
vi.mock('$lib/server/projectLedger', () => ({
	appendLedgerEntry: (p: any) => append(p),
	rebuildProjectStockBalance: (p: any) => rebuild(p),
	TRANSACTION_TYPES: { IN_RECEIPT: 'IN-RECEIPT' }
}));

const { receiveProjectDelivery, rencanakanPenerimaan, sjMelewatiBatas } = await import('./receiveProjectDelivery');

const exp = (o: any = {}) => ({ id: 1, project_id: 5, identitas_barang_id: 100, qty_sent: 4, unit_price: 50, rab_budget_id: null, source: 'surat_jalan', ...o });

beforeEach(() => {
	calls.length = 0;
	append.mockClear();
	rebuild.mockClear();
	ledgerLama = [];
	ledgerGagal = false;
	expenses = [exp()];
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('rencanakanPenerimaan (murni)', () => {
	it('kunci per BARIS biaya — barang sama di dua baris menghasilkan dua entri (bug lama kunci per-item)', () => {
		const r = rencanakanPenerimaan(7, [exp({ id: 1 }), exp({ id: 2, qty_sent: 3 })], []);
		expect(r.tulis.map((t) => t.kunci)).toEqual(['recv-7-exp-1', 'recv-7-exp-2']);
		expect(r.tulis.every((t) => t.tulisLedger)).toBe(true);
	});
	it('item yang SJ-nya sudah punya IN-RECEIPT lama tidak ditulis ulang tetapi biaya tetap diakui', () => {
		const r = rencanakanPenerimaan(7, [exp()], [{ item_id: 100 }]);
		expect(r.tulis[0].tulisLedger).toBe(false);
		expect(r.lewati[0].alasan).toMatch(/IN-RECEIPT lama/);
	});
	it('qty_sent kosong dilewati; alat sewa-internal tidak mengubah nilai', () => {
		const r = rencanakanPenerimaan(7, [exp({ qty_sent: 0 }), exp({ id: 3, source: 'sj_equipment_usage' })], []);
		expect(r.lewati[0].expenseId).toBe(1);
		expect(r.tulis[0].nilai).toBe(-1);
	});
});

describe('receiveProjectDelivery', () => {
	it('mengakui biaya (is_received, qty, nilai) + IN-RECEIPT per baris + rebuild saldo', async () => {
		const r = await receiveProjectDelivery(7, { by: { id: 4, nama: 'Satpam' }, source: 'gerbang' });
		expect(r).toMatchObject({ diakui: 1, ledgerDitulis: 1 });
		const patch = calls.find((c) => c.method === 'PATCH')!;
		expect(patch.body).toMatchObject({ is_received: true, qty: 4, expense_amount: 200, debit_amount: 200 });
		expect(append).toHaveBeenCalledWith(expect.objectContaining({ clientTxnId: 'recv-7-exp-1', quantity: 4, itemId: 100, referenceId: 7 }));
		expect(rebuild).toHaveBeenCalledWith({ projectId: 5 });
	});
	it('idempoten: ledger dedup → tidak dihitung ditulis, tanpa rebuild', async () => {
		append.mockResolvedValueOnce({ entry: { id: 1 }, deduped: true } as any);
		const r = await receiveProjectDelivery(7, { source: 'auto_batas' });
		expect(r.ledgerDitulis).toBe(0);
		expect(rebuild).not.toHaveBeenCalled();
	});
	it('tanpa biaya tertunda → tidak menulis apa pun', async () => {
		expenses = [];
		expect(await receiveProjectDelivery(7, { source: 'gerbang' })).toMatchObject({ diakui: 0, ledgerDitulis: 0 });
		expect(append).not.toHaveBeenCalled();
	});
	it('ledger lama tak terbaca → berhenti dengan error (bukan menebak & berisiko ganda); biaya tidak disentuh', async () => {
		ledgerGagal = true;
		await expect(receiveProjectDelivery(7, { source: 'gerbang' })).rejects.toThrow(/ledger lama/);
		expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
	});
});

describe('sjMelewatiBatas', () => {
	it('memakai waktu lolos gerbang, jatuh ke date_created', () => {
		const now = new Date('2026-10-24T00:00:00Z').getTime();
		const r = sjMelewatiBatas(
			[
				{ id: 1, security_verified_at: '2026-10-20T00:00:00Z' },
				{ id: 2, security_verified_at: '2026-10-23T00:00:00Z' },
				{ id: 3, date_created: '2026-10-01T00:00:00Z' }
			],
			3,
			now
		);
		expect(r.map((s) => s.id)).toEqual([1, 3]);
	});
});
