// RSM-04 — gerbang MASUK retur: aturan status, QR, checklist, idempotensi, tahan, karantina.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GateActor } from './types';

type Call = { path: string; method: string; body: any };
const calls: Call[] = [];
let header: any;
let scanPrior: any[] = [];
let casResult: any[] = [{ id: 1 }];

vi.mock('../directus', () => ({
	directusServerJson: vi.fn(async (path: string, opts: any = {}) => {
		const method = opts?.method || 'GET';
		const body = opts?.body ? JSON.parse(opts.body) : null;
		calls.push({ path, method, body });
		if (method === 'PATCH' && path === '/items/retur_gudang') return { data: casResult };
		if (method === 'GET' && /^\/items\/retur_gudang\/\d+/.test(path)) return { data: header };
		if (method === 'GET' && path.startsWith('/items/retur_gudang?')) return { data: header ? [header] : [] };
		if (path.startsWith('/items/scan_log?')) return { data: scanPrior };
		if (path.startsWith('/items/app_settings')) return { data: [] };
		if (path.startsWith('/items/packing_returns')) return { data: [{ id: 9, material_name: 'HELM', qty_returned: 6, unit: 'Pcs' }] };
		return { data: [] };
	})
}));
const createDoc = vi.fn(async () => ({ id: 77, nomor_retur: 'RTN/261024/002', qr_token: 'q', status: 'draft', linked: 0, linkedEquipment: 0 }));
vi.mock('../returGudangServer', () => ({ createReturDocument: (i: any) => createDoc(i) }));
vi.mock('./effects', () => ({ runEffect: async (_n: string, _id: number, fn: () => Promise<unknown>) => { await fn(); return null; }, notifyLogistik: vi.fn(async () => {}) }));

const { parseReturQuery, cariRetur, loloskanRetur, tahanRetur, catatTanpaDokumen, resetReturChecklistCache } = await import('./retur');

const actor: GateActor = { sumber: 'app', karyawanId: 4, nama: 'Satpam A', email: null, label: 'APP/Satpam A' };
const cekOk = { jumlah_koli_cocok: true, plat_cocok: true, tidak_ada_barang_tambahan: true };
const ev = (n = 1) => `evt-abcdefgh-${n}`;

beforeEach(() => {
	calls.length = 0;
	scanPrior = [];
	casResult = [{ id: 1 }];
	resetReturChecklistCache();
	header = { id: 1, nomor_retur: 'RTN/261023/001', status: 'dikirim', sumber: 'lapangan', project_id: 575, qr_token: 'tok', security_verified_at: null, notes: null, shipped_at: '2026-10-23T01:00:00Z' };
});

describe('parseReturQuery', () => {
	it('QR mentah & nomor polos', () => {
		expect(parseReturQuery('EPI:RTN:12:abc-def')).toEqual({ id: 12, token: 'abc-def', nomor: null });
		expect(parseReturQuery(' RTN/261023/001 ')).toEqual({ id: null, token: null, nomor: 'RTN/261023/001' });
	});
});

describe('cariRetur', () => {
	it('token QR salah ditolak', async () => {
		await expect(cariRetur('EPI:RTN:1:salah')).rejects.toMatchObject({ kode: 'QR_TIDAK_COCOK' });
	});
	it('draft -> perlu_tandai_berangkat; sudah diverifikasi -> pesan "Sudah diverifikasi" (bukan error)', async () => {
		header.status = 'draft';
		expect((await cariRetur('EPI:RTN:1:tok')).perlu_tandai_berangkat).toBe(true);
		header = { ...header, status: 'dikirim', security_verified_at: '2026-10-24T02:00:00Z', security_verified_by: 'KIOSK/Budi' };
		const r = await cariRetur('RTN/261023/001');
		expect(r.sudah_diverifikasi).toBe(true);
		expect(r.pesan).toMatch(/Sudah diverifikasi/);
	});
});

describe('loloskanRetur', () => {
	it('dikirim + checklist lengkap -> CAS PATCH, scan_log gerbang_gudang', async () => {
		const r = await loloskanRetur(1, { client_event_id: ev(), checklist: cekOk }, actor);
		expect(r).toMatchObject({ hasil: 'lolos', idempoten: false });
		const patch = calls.find((c) => c.method === 'PATCH')!;
		expect(patch.body.data).toMatchObject({ qr_token_used: true, security_verified_by: 'APP/Satpam A' });
		expect(patch.body.data).not.toHaveProperty('status');
		const scan = calls.find((c) => c.method === 'POST' && c.path === '/items/scan_log')!;
		expect(scan.body).toMatchObject({ ref_collection: 'retur_gudang', stage_to: 'gerbang_gudang', actor_role: 'satpam' });
	});

	it('draft tanpa tandai_berangkat -> 409 BELUM_SIAP_GERBANG; dengan flag -> naik ke dikirim', async () => {
		header.status = 'draft';
		await expect(loloskanRetur(1, { client_event_id: ev(1), checklist: cekOk }, actor)).rejects.toMatchObject({ status: 409, kode: 'BELUM_SIAP_GERBANG' });
		await loloskanRetur(1, { client_event_id: ev(2), checklist: cekOk, tandai_berangkat: true }, actor);
		const patch = calls.find((c) => c.method === 'PATCH')!;
		expect(patch.body.data).toMatchObject({ status: 'dikirim' });
		expect(patch.body.data.notes).toContain('berangkat dicatat satpam');
	});

	it('checklist tidak lengkap -> CEK_BELUM_LENGKAP, tidak ada PATCH', async () => {
		await expect(loloskanRetur(1, { client_event_id: ev(), checklist: { jumlah_koli_cocok: true } }, actor)).rejects.toMatchObject({ kode: 'CEK_BELUM_LENGKAP' });
		expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
	});

	it('sudah diverifikasi -> idempoten (QR dipakai ulang bukan error)', async () => {
		header.security_verified_at = '2026-10-24T02:00:00Z';
		const r = await loloskanRetur(1, { client_event_id: ev(), checklist: cekOk }, actor);
		expect(r.idempoten).toBe(true);
		expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
	});

	it('kalah balapan CAS (0 baris) -> idempoten', async () => {
		casResult = [];
		const r = await loloskanRetur(1, { client_event_id: ev(), checklist: cekOk }, actor);
		expect(r.idempoten).toBe(true);
	});

	it('dokumen final ditolak', async () => {
		header.status = 'diterima';
		await expect(loloskanRetur(1, { client_event_id: ev(), checklist: cekOk }, actor)).rejects.toMatchObject({ kode: 'STATUS_BERUBAH' });
	});
});

describe('tahanRetur & catatTanpaDokumen', () => {
	it('tahan wajib alasan >= 10 karakter; status dokumen tidak berubah', async () => {
		await expect(tahanRetur(1, { client_event_id: ev(), alasan: 'pendek' }, actor)).rejects.toMatchObject({ kode: 'ALASAN_WAJIB' });
		const r = await tahanRetur(1, { client_event_id: ev(2), alasan: 'Jumlah koli kurang 2 dari dokumen' }, actor);
		expect(r.hasil).toBe('ditahan');
		const p = calls.find((c) => c.method === 'PATCH')!;
		expect(Object.keys(p.body)).toEqual(['notes']);
		expect(calls.find((c) => c.path === '/items/scan_log' && c.method === 'POST')!.body.stage_to).toBe('ditahan_gerbang');
	});

	it('tanpa dokumen -> membuat dokumen karantina draft yang sudah lolos gerbang', async () => {
		const r = await catatTanpaDokumen({ client_event_id: ev(), project_id: 575, catatan: 'Truk B 123 XX bawa 5 koli cat' }, actor);
		expect(r).toMatchObject({ hasil: 'dicatat', idempoten: false });
		expect(createDoc).toHaveBeenCalledWith(expect.objectContaining({ sumber: 'karantina', status: 'draft', projectId: 575 }));
		const mark = calls.find((c) => c.method === 'PATCH' && c.path === '/items/retur_gudang/77')!;
		expect(mark.body).toMatchObject({ qr_token_used: true });
	});
});
