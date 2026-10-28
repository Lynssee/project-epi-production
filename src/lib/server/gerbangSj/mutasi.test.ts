// RSM-13 — gerbang e-SJ Mutasi rute via_gudang: antrean, aturan status, checklist, idempotensi, tahan.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GateActor } from './types';

type Call = { path: string; method: string; body: any };
const calls: Call[] = [];
let heads: any[] = [];
let header: any;
let scanPrior: any[] = [];
let casResult: any[] = [{ id: 1 }];
let queueError = false;

vi.mock('../directus', () => ({
	directusServerJson: vi.fn(async (path: string, opts: any = {}) => {
		const method = opts?.method || 'GET';
		const body = opts?.body ? JSON.parse(opts.body) : null;
		calls.push({ path, method, body });
		if (method === 'PATCH' && path === '/items/mutasi_barang') return { data: casResult };
		if (method === 'GET' && /^\/items\/mutasi_barang\/\d+/.test(path)) return { data: header };
		if (method === 'GET' && path.startsWith('/items/mutasi_barang?')) {
			if (queueError) throw new Error('403 FORBIDDEN');
			return { data: heads };
		}
		if (path.startsWith('/items/scan_log?')) return { data: scanPrior };
		if (path.startsWith('/items/app_settings')) return { data: [] };
		if (path.startsWith('/items/mutasi_barang_items')) return { data: [{ id: 5, mutasi_id: 1, item_id: 10, qty: 3, unit: 'Pcs' }] };
		if (path.startsWith('/items/identitas_barang')) return { data: [{ id: 10, nama_barang_lengkap: 'Frame' }] };
		if (path.startsWith('/items/projects')) return { data: [{ id: 1, name: 'Proyek A' }] };
		return { data: [] };
	})
}));
vi.mock('./effects', () => ({ runEffect: async (_n: string, _id: number, fn: () => Promise<unknown>) => { await fn(); return null; }, notifyLogistik: vi.fn(async () => {}) }));

const { getAntrianMutasi, loloskanMutasi, tahanMutasi, resetMutasiChecklistCache } = await import('./mutasi');

const actor: GateActor = { sumber: 'app', karyawanId: 4, nama: 'Satpam A', email: null, label: 'APP/Satpam A' };
const cekOk = { jumlah_cocok: true, plat_cocok: true };
const ev = (n = 1) => `evt-abcdefgh-${n}`;

beforeEach(() => {
	calls.length = 0;
	scanPrior = [];
	casResult = [{ id: 1 }];
	queueError = false;
	resetMutasiChecklistCache();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	header = { id: 1, nomor_mutasi: 'MUT/261026/001', status: 'dikirim', rute: 'via_gudang', asal_tipe: 'project', asal_id: 1, tujuan_tipe: 'gudang', tujuan_id: 1, security_verified_at: null, riwayat: [{ keputusan: 'kirim' }], shipped_at: '2026-10-26T01:00:00Z' };
	heads = [header];
});

describe('getAntrianMutasi', () => {
	it('hanya rute via_gudang berstatus dikirim & belum lolos (filter di query), lengkap dengan barang & nama lokasi', async () => {
		const r = await getAntrianMutasi();
		const q = calls.find((c) => c.path.startsWith('/items/mutasi_barang?'))!.path;
		expect(q).toContain('filter[status][_eq]=dikirim');
		expect(q).toContain('filter[rute][_eq]=via_gudang');
		expect(q).toContain('filter[security_verified_at][_null]=true');
		expect(r.count).toBe(1);
		expect(r.antrian[0]).toMatchObject({ nomor_mutasi: 'MUT/261026/001', asal: 'Proyek A', tujuan: 'Gudang Pusat' });
		expect(r.antrian[0].items).toEqual([{ id: 5, nama: 'Frame', qty: 3, unit: 'Pcs' }]);
		expect(r.checklist.map((c) => c.key)).toEqual(['jumlah_cocok', 'plat_cocok']);
	});
	it('koleksi belum ada → antrean kosong dan error DICATAT (tidak ditelan)', async () => {
		queueError = true;
		const r = await getAntrianMutasi();
		expect(r.count).toBe(0);
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('mutasi_barang'), expect.anything());
	});
});

describe('loloskanMutasi', () => {
	it('sukses: CAS dikirim→lolos_gerbang + security_verified_at + riwayat bertambah + scan_log', async () => {
		const r = await loloskanMutasi(1, { client_event_id: ev(), checklist: cekOk }, actor);
		expect(r).toMatchObject({ hasil: 'lolos', idempoten: false, doc: { status: 'lolos_gerbang' } });
		const patch = calls.find((c) => c.method === 'PATCH')!;
		expect(JSON.stringify(patch.body)).toContain('"status":"lolos_gerbang"');
		expect(patch.body.query.filter._and).toEqual(expect.arrayContaining([{ status: { _eq: 'dikirim' } }, { security_verified_at: { _null: true } }]));
		expect(patch.body.data.security_verified_at).toBeTruthy();
		expect(patch.body.data.riwayat).toHaveLength(2);
		expect(calls.find((c) => c.method === 'POST' && c.path === '/items/scan_log')!.body).toMatchObject({ ref_collection: 'mutasi_barang', stage_to: 'lolos_gerbang' });
	});
	it('langsung_site tidak melewati gerbang → 409 dan tidak ada PATCH', async () => {
		header.rute = 'langsung_site';
		await expect(loloskanMutasi(1, { client_event_id: ev(), checklist: cekOk }, actor)).rejects.toMatchObject({ status: 409 });
		expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
	});
	it('belum berangkat (disetujui) → 409', async () => {
		header.status = 'disetujui_tujuan';
		await expect(loloskanMutasi(1, { client_event_id: ev(), checklist: cekOk }, actor)).rejects.toMatchObject({ status: 409 });
	});
	it('checklist belum lengkap → 400 dan tidak ada PATCH', async () => {
		await expect(loloskanMutasi(1, { client_event_id: ev(), checklist: { jumlah_cocok: true } }, actor)).rejects.toMatchObject({ status: 400 });
		expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
	});
	it('idempoten: sudah diverifikasi / event sama / CAS kosong → tidak menulis dua kali', async () => {
		header.security_verified_at = '2026-10-26T02:00:00Z';
		expect((await loloskanMutasi(1, { client_event_id: ev(), checklist: cekOk }, actor)).idempoten).toBe(true);
		header.security_verified_at = null;
		scanPrior = [{ id: 1 }];
		expect((await loloskanMutasi(1, { client_event_id: ev(2), checklist: cekOk }, actor)).idempoten).toBe(true);
		scanPrior = [];
		casResult = [];
		expect((await loloskanMutasi(1, { client_event_id: ev(3), checklist: cekOk }, actor)).idempoten).toBe(true);
		expect(calls.some((c) => c.method === 'POST' && c.path === '/items/scan_log')).toBe(false);
	});
	it('dokumen tidak ada → 404', async () => {
		header = null;
		await expect(loloskanMutasi(9, { client_event_id: ev(), checklist: cekOk }, actor)).rejects.toMatchObject({ status: 404 });
	});
});

describe('tahanMutasi', () => {
	it('alasan < 10 karakter → 400; sukses mencatat riwayat tanpa mengubah status', async () => {
		await expect(tahanMutasi(1, { client_event_id: ev(), alasan: 'pendek' }, actor)).rejects.toMatchObject({ status: 400 });
		const r = await tahanMutasi(1, { client_event_id: ev(), alasan: 'Barang di truk tidak sesuai dokumen' }, actor);
		expect(r).toMatchObject({ hasil: 'ditahan', idempoten: false, doc: { status: 'dikirim' } });
		const patch = calls.find((c) => c.method === 'PATCH')!;
		expect(patch.body.data.status).toBeUndefined();
		expect(patch.body.data.riwayat.at(-1)).toMatchObject({ keputusan: 'tahan_gerbang' });
	});
});
