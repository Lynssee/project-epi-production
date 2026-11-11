import { describe, it, expect, vi, beforeEach } from 'vitest';

const request = vi.fn();
vi.mock('./directus', () => ({ default: { request: (...a: any[]) => request(...a) }, handleDirectusError: vi.fn() }));
vi.mock('@directus/sdk', () => ({ readItems: (c: string, q: any) => ({ op: 'read', c, q }), createItem: (c: string, d: any) => ({ op: 'create', c, d }) }));

import { createCoatingLog } from './projectCoatingLogApi';

beforeEach(() => vi.clearAllMocks());

describe('createCoatingLog — tag PO (so_customer_id)', () => {
	const base = { projectId: 5, batchNo: 'B1', productId: 7, qtyUsed: 10, satuan: 'kg' };

	it('menyertakan so_customer_id bila diberikan', async () => {
		request.mockResolvedValue({ id: 1 });
		await createCoatingLog({ ...base, soCustomerId: 2001 });
		expect(request.mock.calls[0][0].d.so_customer_id).toBe(2001);
	});

	it('tanpa tag → so_customer_id null (log tetap valid)', async () => {
		request.mockResolvedValue({ id: 1 });
		await createCoatingLog(base);
		expect(request.mock.calls[0][0].d.so_customer_id).toBeNull();
	});

	it('403 karena kolom baru belum diizinkan → simpan ulang TANPA so_customer_id + warning (pencatatan cat tidak gagal)', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		request.mockRejectedValueOnce({ response: { status: 403 } }).mockResolvedValueOnce({ id: 2 });
		const r = await createCoatingLog({ ...base, soCustomerId: 2001 });
		expect(r).toEqual({ id: 2 });
		expect(request).toHaveBeenCalledTimes(2);
		expect('so_customer_id' in request.mock.calls[1][0].d).toBe(false);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it('error non-403 tidak di-retry; 403 tanpa tag PO tidak di-retry', async () => {
		request.mockRejectedValue({ response: { status: 500 } });
		await expect(createCoatingLog({ ...base, soCustomerId: 1 })).rejects.toBeTruthy();
		expect(request).toHaveBeenCalledTimes(1);
		vi.clearAllMocks();
		request.mockRejectedValue({ response: { status: 403 } });
		await expect(createCoatingLog(base)).rejects.toBeTruthy();
		expect(request).toHaveBeenCalledTimes(1);
	});
});
