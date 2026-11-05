import { describe, it, expect, vi, beforeEach } from 'vitest';

const recorder = vi.hoisted(() => vi.fn(async () => ({ saved: 1 })));
const relay = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/firebaseAuth', () => ({ requireUser: vi.fn(async () => ({ email: 'mekanik@eltama.co.id', localId: 'u1' })) }));
vi.mock('$lib/server/inventoryInspectionRecorder', () => ({ recordInspectionsForDocument: recorder }));
vi.mock('$lib/server/inventorySpecShadow', () => ({ reportInventorySpecShadow: relay }));

import { POST } from './+server';

const call = (body: unknown) =>
	POST({ request: new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }) } as any);

beforeEach(() => {
	recorder.mockClear();
	relay.mockClear();
});

describe('POST /api/inventory-360/inspeksi-terima', () => {
	it('merekam checklist dengan koleksi/ID dokumen lalu me-relay gate (shadow) dengan email pelapor dari sesi', async () => {
		const res = await call({ collection: 'items/stock_transactions', recordId: 42, label: 'Penerimaan manual REF-1', identitasBarangIds: [10], inspeksi: [{ itemId: 10 }] });
		expect(res.status).toBe(200);
		expect(recorder).toHaveBeenCalledWith(expect.objectContaining({ collection: 'items/stock_transactions', recordId: '42', userEmail: 'mekanik@eltama.co.id' }));
		expect(relay).toHaveBeenCalledWith({ kind: 'receive', collection: 'items/stock_transactions', recordId: '42', itemIds: [10], userEmail: 'mekanik@eltama.co.id' });
	});

	it('menolak koleksi di luar daftar izin dan id kosong (tidak memalsukan dokumen lain)', async () => {
		await expect(call({ collection: 'items/goods_receipt_notes', recordId: 1 })).rejects.toMatchObject({ status: 400 });
		await expect(call({ collection: 'items/stock_transactions', recordId: '' })).rejects.toMatchObject({ status: 400 });
		expect(recorder).not.toHaveBeenCalled();
		expect(relay).not.toHaveBeenCalled();
	});
});
