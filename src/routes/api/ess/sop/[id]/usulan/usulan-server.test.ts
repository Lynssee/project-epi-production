import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/ess/attendanceGuard', () => ({ authenticateEss: vi.fn() }));
const mockDirectus = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => mockDirectus(...a) }));
const mockGetSop = vi.fn();
vi.mock('$lib/server/ess/sop', () => ({
	getSopById: (...a: any[]) => mockGetSop(...a),
	isReadableSop: (s: any) => Boolean(s) && (s.status === 'published' || s.approval_status === 'butuh_sosialisasi')
}));

import { POST } from './+server';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';

const LONG = 'Langkah 3 menyebut cek manual padahal di lapangan memakai alat ukur.';
const SOP = { id: 7, title: 'SOP Penerimaan Barang', sop_code: 'WH-001', department: 'Warehouse', version: 'v1.2', version_seq: 12, status: 'published' };

const ev = (body: any, id = '7') => ({ params: { id }, request: { json: async () => body } }) as any;
const posts = () => mockDirectus.mock.calls.filter((c) => c[1]?.method === 'POST');

describe('POST /api/ess/sop/[id]/usulan', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		(authenticateEss as any).mockResolvedValue({ user: {}, karyawan: { id: 42, nama_karyawan: 'Budi', divisi: 'Warehouse' } });
		mockGetSop.mockResolvedValue(SOP);
		mockDirectus.mockImplementation(async (_u: string, opt: any) => (opt?.method === 'POST' ? { data: { id: 501 } } : { data: [] }));
	});

	it('sukses: menulis proposed_sop source lapangan dengan identitas dari sesi server', async () => {
		const json = await (await POST(ev({ jenis: 'tidak_sesuai', catatan: LONG, karyawan_id: 999 }))).json();
		expect(json).toEqual({ success: true, id: 501 });
		const [url, opt] = posts()[0];
		expect(url).toBe('/items/proposed_sop');
		const body = JSON.parse(opt.body);
		expect(body).toMatchObject({ source: 'lapangan', status: 'draft' });
		expect(body.data_snapshot.karyawan_id).toBe(42); // kiriman klien 999 diabaikan
		expect(body.justifikasi_masalah).toContain(LONG);
	});

	it('SOP masa sosialisasi (belum published) juga bisa diusulkan; SOP draft/arsip → 404', async () => {
		mockGetSop.mockResolvedValue({ ...SOP, status: 'draft', approval_status: 'butuh_sosialisasi' });
		expect((await (await POST(ev({ jenis: 'lainnya', catatan: LONG }))).json()).success).toBe(true);
		mockGetSop.mockResolvedValue({ ...SOP, status: 'draft', approval_status: 'draft' });
		await expect(POST(ev({ jenis: 'lainnya', catatan: LONG }))).rejects.toMatchObject({ status: 404 });
		mockGetSop.mockResolvedValue(null);
		await expect(POST(ev({ jenis: 'lainnya', catatan: LONG }))).rejects.toMatchObject({ status: 404 });
	});

	it('ID tidak valid → 400; validasi isian → 400; JSON rusak → 400', async () => {
		await expect(POST(ev({ jenis: 'lainnya', catatan: LONG }, 'abc'))).rejects.toMatchObject({ status: 400 });
		await expect(POST(ev({ jenis: 'lainnya', catatan: 'pendek' }))).rejects.toMatchObject({ status: 400 });
		await expect(POST(ev({ jenis: 'xx', catatan: LONG }))).rejects.toMatchObject({ status: 400 });
		await expect(POST({ params: { id: '7' }, request: { json: async () => { throw new Error('x'); } } } as any)).rejects.toMatchObject({ status: 400 });
		expect(posts()).toHaveLength(0);
	});

	it('usulan terbuka untuk SOP yang sama → 429 tanpa menulis', async () => {
		mockDirectus.mockImplementation(async (_u: string, opt: any) =>
			opt?.method === 'POST' ? { data: { id: 1 } } : { data: [{ id: 3, status: 'draft', date_created: new Date().toISOString(), data_snapshot: { karyawan_id: 42, sop_id: 7 } }] }
		);
		await expect(POST(ev({ jenis: 'lainnya', catatan: LONG }))).rejects.toMatchObject({ status: 429 });
		expect(posts()).toHaveLength(0);
	});

	it('gagal membaca usulan terakhir → 502 (bukan lolos tanpa batas)', async () => {
		mockDirectus.mockRejectedValue(new Error('down'));
		await expect(POST(ev({ jenis: 'lainnya', catatan: LONG }))).rejects.toMatchObject({ status: 502 });
		expect(posts()).toHaveLength(0);
	});

	it('gagal menyimpan → 502', async () => {
		mockDirectus.mockImplementation(async (_u: string, opt: any) => {
			if (opt?.method === 'POST') throw new Error('boom');
			return { data: [] };
		});
		await expect(POST(ev({ jenis: 'lainnya', catatan: LONG }))).rejects.toMatchObject({ status: 502 });
	});

	it('query batas hanya meminta kolom skema live', async () => {
		await POST(ev({ jenis: 'lainnya', catatan: LONG }));
		const read = String(mockDirectus.mock.calls.find((c) => !c[1]?.method)![0]);
		expect(read).toContain('filter[source][_eq]=lapangan');
		const fields = /fields=([^&]*)/.exec(read)![1].split(',');
		for (const f of fields) expect(['id', 'status', 'date_created', 'data_snapshot']).toContain(f);
	});
});
