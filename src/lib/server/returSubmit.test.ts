// RSM-02/03 — pengajuan retur satu request: idempoten, rollback, dan gate G_RTN_DOBEL.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = { path: string; method: string; body: any };
const calls: Call[] = [];
let handler: (path: string, method: string, body: any) => any = () => ({ data: [] });

vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn(async (path: string, opts: any = {}) => {
		const method = opts?.method || 'GET';
		const body = opts?.body ? JSON.parse(opts.body) : null;
		calls.push({ path, method, body });
		return handler(path, method, body);
	})
}));
const gateMode = vi.fn(async () => 'shadow' as 'shadow' | 'soft' | 'hard');
vi.mock('$lib/server/gateEnforcement', () => ({ getFieldGateMode: (k: string) => gateMode(k) }));
const audit = vi.fn(async () => {});
vi.mock('$lib/server/gates/gateAudit', () => ({ writeGateAudit: (p: any) => audit(p) }));
const createDoc = vi.fn();
vi.mock('$lib/server/returGudangServer', () => ({ createReturDocument: (i: any) => createDoc(i) }));

const { submitReturPengajuan, ReturSubmitError, findActiveReturDuplicates } = await import('./returSubmit');

const base = {
	projectId: 10,
	items: [{ material_name: 'HELM', qty_returned: 6, unit: 'Pcs', condition: 'ok', item_id: 21866 }],
	submittedByName: 'Budi',
	submittedByKaryawanId: 7,
	submittedByUid: 'uid1',
	email: 'b@x.id',
	penerbit: 'inventory' as const
};

let nextRowId = 100;
function defaultHandler(path: string, method: string) {
	if (method === 'POST' && path.startsWith('/items/packing_returns')) return { data: { id: nextRowId++ } };
	return { data: [] };
}

beforeEach(() => {
	calls.length = 0;
	nextRowId = 100;
	handler = defaultHandler;
	gateMode.mockReset().mockResolvedValue('shadow');
	audit.mockReset();
	createDoc.mockReset().mockImplementation(async (i: any) => ({ id: 5, nomor_retur: 'RTN/261024/001', qr_token: 'q', status: i.status, linked: i.packingReturnIds.length, linkedEquipment: 0 }));
});

describe('submitReturPengajuan', () => {
	it('selalu membuat header draft (leader langsung dapat nomor) + menaruh tag sub di notes', async () => {
		const r = await submitReturPengajuan({ ...base, clientSubmissionId: 'abc' });
		expect(r.doc?.nomor_retur).toBe('RTN/261024/001');
		expect(r.rowIds).toEqual([100]);
		const arg = createDoc.mock.calls[0][0];
		expect(arg.status).toBe('draft');
		expect(arg.notes).toContain('[sub:abc]');
		expect(arg.packingReturnIds).toEqual([100]);
	});

	it('penerbit lapangan: header langsung dikirim dengan data sopir', async () => {
		await submitReturPengajuan({ ...base, penerbit: 'lapangan', driverName: 'ADYOSO' });
		const arg = createDoc.mock.calls[0][0];
		expect(arg.status).toBe('dikirim');
		expect(arg.driverName).toBe('ADYOSO');
	});

	it('idempoten: client id yang sama mengembalikan dokumen lama tanpa membuat baris baru', async () => {
		handler = (path) => {
			if (path.startsWith('/items/retur_gudang?')) return { data: [{ id: 5, nomor_retur: 'RTN/261024/001', qr_token: 'q', status: 'draft' }] };
			if (path.startsWith('/items/packing_returns?')) return { data: [{ id: 100 }, { id: 101 }] };
			return { data: [] };
		};
		const r = await submitReturPengajuan({ ...base, clientSubmissionId: 'abc' });
		expect(r.idempotent).toBe(true);
		expect(r.rowIds).toEqual([100, 101]);
		expect(calls.some((c) => c.method === 'POST')).toBe(false);
		expect(createDoc).not.toHaveBeenCalled();
	});

	it('rollback: header gagal -> baris yang baru dibuat dihapus & error jelas (aman diulang)', async () => {
		createDoc.mockRejectedValueOnce(new Error('jaringan putus'));
		await expect(submitReturPengajuan({ ...base, items: [base.items[0], { ...base.items[0], item_id: 2 }] })).rejects.toMatchObject({ status: 502, code: 'RTN_DOC_FAILED' });
		const deleted = calls.filter((c) => c.method === 'DELETE').map((c) => c.path);
		expect(deleted).toEqual(['/items/packing_returns/100', '/items/packing_returns/101']);
	});

	it('rollback: baris kedua gagal -> baris pertama dihapus', async () => {
		let n = 0;
		handler = (path, method) => {
			if (method === 'POST') {
				n++;
				if (n === 2) throw new Error('403');
				return { data: { id: 100 } };
			}
			return { data: [] };
		};
		await expect(submitReturPengajuan({ ...base, items: [base.items[0], { ...base.items[0], item_id: 2 }] })).rejects.toMatchObject({ code: 'RTN_ROWS_FAILED' });
		expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/items/packing_returns/100']);
		expect(createDoc).not.toHaveBeenCalled();
	});
});

describe('gate G_RTN_DOBEL', () => {
	// retur aktif 6 Pcs untuk item 21866 di dokumen RTN/260917/001; saldo proyek 6
	const dobelHandler = (path: string, method: string) => {
		if (method === 'POST' && path.startsWith('/items/packing_returns')) return { data: { id: nextRowId++ } };
		if (path.startsWith('/items/packing_returns?')) return { data: [{ id: 50, item_id: 21866, qty_returned: 6, retur_gudang_id: 3 }] };
		if (path.startsWith('/items/retur_gudang?')) return { data: [{ id: 3, status: 'draft', nomor_retur: 'RTN/260917/001' }] };
		if (path.startsWith('/items/project_stock_balance')) return { data: [{ item_id: 21866, qty_on_hand: 6 }] };
		return { data: [] };
	};

	it('shadow: tetap tersimpan, tercatat di gate_audit_log', async () => {
		handler = dobelHandler;
		const r = await submitReturPengajuan(base);
		expect(r.doc).toBeTruthy();
		expect(r.dobel).toHaveLength(1);
		expect(audit).toHaveBeenCalledWith(expect.objectContaining({ gate: 'G_RTN_DOBEL', decision: 'shadow' }));
	});

	it('soft tanpa alasan -> 409 RTN_DOBEL, tidak ada baris dibuat', async () => {
		handler = dobelHandler;
		gateMode.mockResolvedValue('soft');
		await expect(submitReturPengajuan(base)).rejects.toMatchObject({ status: 409, code: 'RTN_DOBEL' });
		expect(calls.some((c) => c.method === 'POST')).toBe(false);
		expect(audit).toHaveBeenCalledWith(expect.objectContaining({ decision: 'block' }));
	});

	it('soft dengan alasan >= 20 karakter -> lolos & dicatat allow', async () => {
		handler = dobelHandler;
		gateMode.mockResolvedValue('soft');
		const r = await submitReturPengajuan({ ...base, overrideReason: 'Gelombang demobilisasi kedua, barang berbeda' });
		expect(r.doc).toBeTruthy();
		expect(audit).toHaveBeenCalledWith(expect.objectContaining({ decision: 'allow' }));
	});

	it('hard menolak walau ada alasan', async () => {
		handler = dobelHandler;
		gateMode.mockResolvedValue('hard');
		await expect(submitReturPengajuan({ ...base, overrideReason: 'Alasan yang cukup panjang sekali ya' })).rejects.toBeInstanceOf(ReturSubmitError);
	});

	it('bukan dobel bila saldo masih cukup untuk total (lama + baru)', async () => {
		handler = (path, method) => {
			if (path.startsWith('/items/project_stock_balance')) return { data: [{ item_id: 21866, qty_on_hand: 12 }] };
			return dobelHandler(path, method);
		};
		const d = await findActiveReturDuplicates(10, base.items);
		expect(d).toHaveLength(0);
	});

	it('header batal/ditolak tidak dihitung retur aktif', async () => {
		handler = (path, method) => {
			if (path.startsWith('/items/retur_gudang?')) return { data: [{ id: 3, status: 'batal', nomor_retur: 'X' }] };
			return dobelHandler(path, method);
		};
		expect(await findActiveReturDuplicates(10, base.items)).toHaveLength(0);
	});
});
