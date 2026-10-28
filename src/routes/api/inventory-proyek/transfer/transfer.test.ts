// RSM-13 §4.5 — jalur lama "Pindah Proyek": dapat dimatikan lewat setelan (410) dan menghormati qty terkunci mutasi.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let setelanAktif: boolean | undefined;
let saldo = 10;
let terkunci = new Map<number, number>();
const ledger = vi.fn(async () => ({ entry: { id: 1 }, deduped: false }));

vi.mock('$lib/server/goodsReceived/guard', () => ({ authenticateProjectLeader: vi.fn(async () => ({ karyawan: { id: 7 }, projectIds: [1] })) }));
vi.mock('$lib/server/projectLedger', () => ({
	appendLedgerEntry: (p: unknown) => ledger(p),
	rebuildProjectStockBalance: vi.fn(async () => {}),
	TRANSACTION_TYPES: { TRANSFER_OUT: 'TRANSFER-OUT', TRANSFER_IN: 'TRANSFER-IN' }
}));
vi.mock('$lib/server/inventorySettings', () => ({
	resolvePilotProjectIds: vi.fn(async () => null),
	isPilotProject: () => true,
	getInventorySettingServer: vi.fn(async (_k: string, fb: unknown) => (setelanAktif === undefined ? fb : setelanAktif))
}));
vi.mock('$lib/server/mutasiQtyTerkunci', () => ({
	getQtyTerkunciMutasi: vi.fn(async () => terkunci),
	saldoTersedia: (a: number, b: number) => Math.max(0, a - b)
}));
vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn(async (path: string) => {
		if (path.startsWith('/items/projects')) return { data: [{ id: 2, status: 'active' }] };
		if (path.startsWith('/items/project_stock_ledger')) return { data: [] };
		if (path.startsWith('/items/project_stock_balance')) return { data: [{ qty_on_hand: saldo }] };
		return { data: [] };
	})
}));

const { POST } = await import('./+server');

const ev = (body: unknown) => ({ request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) }) as any;
const body = { sourceProjectId: 1, destProjectId: 2, identitasBarangId: 10, quantity: 4, batchId: 'b1' };

beforeEach(() => {
	setelanAktif = undefined;
	saldo = 10;
	terkunci = new Map();
	ledger.mockClear();
});

describe('POST /api/inventory-proyek/transfer (jalur lama)', () => {
	it('default aktif: menulis TRANSFER-OUT dan TRANSFER-IN', async () => {
		const r = await POST(ev(body));
		expect((await r.json()).written).toBe(true);
		expect(ledger).toHaveBeenCalledTimes(2);
	});
	it('setelan jalur_lama_aktif=false → 410 dengan arahan ke Mutasi Barang, tanpa menulis ledger', async () => {
		setelanAktif = false;
		await expect(POST(ev(body))).rejects.toMatchObject({ status: 410 });
		expect(ledger).not.toHaveBeenCalled();
	});
	it('qty terkunci mutasi mengurangi saldo yang boleh dipindah → 409', async () => {
		terkunci = new Map([[10, 8]]); // saldo 10 − terkunci 8 = 2 < 4
		await expect(POST(ev(body))).rejects.toMatchObject({ status: 409 });
		expect(ledger).not.toHaveBeenCalled();
	});
	it('saldo cukup setelah dikurangi terkunci → lolos', async () => {
		terkunci = new Map([[10, 2]]);
		expect((await (await POST(ev(body))).json()).written).toBe(true);
	});
});
