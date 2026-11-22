import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireUser = vi.fn();
const getUserPermissions = vi.fn();
const resolveProjectScope = vi.fn();
const directusServerJson = vi.fn();
const getKaryawanByFirebaseUid = vi.fn();
vi.mock('$lib/server/firebaseAuth', () => ({ requireUser: (...a: any[]) => requireUser(...a) }));
vi.mock('$lib/server/rbacServer', () => ({ getUserPermissions: (...a: any[]) => getUserPermissions(...a) }));
vi.mock('$lib/server/aiProjectScope', () => ({ resolveProjectScope: (...a: any[]) => resolveProjectScope(...a), isProjectAllowed: (ids: number[] | null, id: number) => ids === null || ids.includes(id) }));
vi.mock('$lib/server/approvalSubmit', () => ({ getKaryawanByFirebaseUid: (...a: any[]) => getKaryawanByFirebaseUid(...a) }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => directusServerJson(...a) }));

const { GET, POST } = await import('./+server');

const get = (qs: string) => ({ url: new URL('http://x.test/api/laporan/tutup-bulan?' + qs), request: new Request('http://x.test', { headers: { authorization: 'Bearer tok' } }) }) as any;
const post = (body: any) => ({ url: new URL('http://x.test/api/laporan/tutup-bulan'), request: new Request('http://x.test', { method: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) }) }) as any;

beforeEach(() => {
	vi.clearAllMocks();
	requireUser.mockResolvedValue({ localId: 'u1', email: 'pl@x.test' });
	getUserPermissions.mockResolvedValue({ permissions: ['view_own_projects'] });
	resolveProjectScope.mockResolvedValue([7]);
	getKaryawanByFirebaseUid.mockResolvedValue({ id: 42, nama_karyawan: 'Budi PL' });
	directusServerJson.mockImplementation(async (url: string, opts?: any) => {
		if (url.startsWith('/items/projects/')) return { data: { id: 7, name: 'Gudang X' } };
		if (url.startsWith('/items/reports?')) return { data: [{ date: '2026-10-01T08:00:00', status: 'submitted', progress_photos: ['foto-aaaaaa'] }] };
		if (url.startsWith('/items/laporan_bulanan_narasi?')) return { data: [] };
		if (url.startsWith('/items/laporan_bulanan_narasi') && opts?.method) return { data: { id: 1, ...JSON.parse(opts.body) } };
		throw new Error('url tak terduga: ' + url);
	});
});

describe('GET /api/laporan/tutup-bulan', () => {
	it('mengembalikan checklist, peringatan, kandidat foto; belum ada narasi', async () => {
		const r = await (await GET(get('projectId=7&period=2026-10'))).json();
		expect(r.success).toBe(true);
		expect(r.schemaReady).toBe(true);
		expect(r.narasi).toBeNull();
		expect(r.checklist.hariBerlapor).toBe(1);
		expect(r.warnings.join(' ')).toContain('Kendala utama belum diisi');
		expect(r.photoCandidates.map((p: any) => p.id)).toEqual(['foto-aaaaaa']);
	});

	it('validasi parameter 400; proyek di luar cakupan 403 tanpa menyentuh data', async () => {
		await expect(GET(get('projectId=x'))).rejects.toMatchObject({ status: 400 });
		await expect(GET(get('projectId=7&period=2026-13'))).rejects.toMatchObject({ status: 400 });
		await expect(GET(get('projectId=8&period=2026-10'))).rejects.toMatchObject({ status: 403 });
		expect(directusServerJson).not.toHaveBeenCalled();
	});

	it('koleksi narasi belum dibuat → schemaReady:false (halaman tetap jalan, galat dilaporkan)', async () => {
		directusServerJson.mockImplementation(async (url: string) => {
			if (url.startsWith('/items/projects/')) return { data: { id: 7 } };
			if (url.startsWith('/items/reports?')) return { data: [] };
			throw new Error("You don't have permission to access collection laporan_bulanan_narasi");
		});
		const r = await (await GET(get('projectId=7&period=2026-10'))).json();
		expect(r.schemaReady).toBe(false);
		expect(r.narasiError).toContain('laporan_bulanan_narasi');
	});

	it('sumber laporan gagal → 502 (bukan data kosong)', async () => {
		directusServerJson.mockRejectedValue(new Error('Directus mati'));
		await expect(GET(get('projectId=7&period=2026-10'))).rejects.toMatchObject({ status: 502 });
	});
});

describe('POST /api/laporan/tutup-bulan', () => {
	const body = { projectId: 7, period: '2026-10', kendala_utama: 'Hujan', rencana_bulan_depan: 'Coating', photo_ids: ['foto-aaaaaa'] };

	it('save: membuat baris draft baru', async () => {
		const r = await (await POST(post({ ...body, action: 'save' }))).json();
		const call = directusServerJson.mock.calls.find((c) => c[1]?.method === 'POST')!;
		expect(call[0]).toBe('/items/laporan_bulanan_narasi');
		expect(JSON.parse(call[1].body)).toMatchObject({ project_id: 7, period: '2026-10', status: 'draft', kendala_utama: 'Hujan' });
		expect(r.success).toBe(true);
	});

	it('close: status closed + pelaku & waktu tercatat; baris lama di-PATCH (upsert, bukan duplikat)', async () => {
		directusServerJson.mockImplementation(async (url: string, opts?: any) => {
			if (url.startsWith('/items/laporan_bulanan_narasi?')) return { data: [{ id: 9, status: 'draft' }] };
			if (opts?.method === 'PATCH') return { data: { id: 9, ...JSON.parse(opts.body) } };
			throw new Error('url tak terduga: ' + url);
		});
		const r = await (await POST(post({ ...body, action: 'close' }))).json();
		const call = directusServerJson.mock.calls.find((c) => c[1]?.method === 'PATCH')!;
		expect(call[0]).toBe('/items/laporan_bulanan_narasi/9');
		expect(JSON.parse(call[1].body)).toMatchObject({ status: 'closed', closed_by: 42, closed_by_name: 'Budi PL' });
		expect(r.narasi.status).toBe('closed');
	});

	it('save pada bulan yang sudah ditutup tidak membukanya; reopen mengosongkan penutupan', async () => {
		directusServerJson.mockImplementation(async (url: string, opts?: any) => {
			if (url.startsWith('/items/laporan_bulanan_narasi?')) return { data: [{ id: 9, status: 'closed' }] };
			return { data: { id: 9, ...JSON.parse(opts.body) } };
		});
		await POST(post({ ...body, action: 'save' }));
		expect(JSON.parse(directusServerJson.mock.calls.at(-1)![1].body).status).toBe('closed');
		await POST(post({ ...body, action: 'reopen' }));
		expect(JSON.parse(directusServerJson.mock.calls.at(-1)![1].body)).toMatchObject({ status: 'draft', closed_at: null, closed_by: null });
	});

	it('input salah 400; di luar cakupan 403; skema belum ada 503; tidak menulis apa pun saat gagal otorisasi', async () => {
		await expect(POST(post({ ...body, period: 'salah' }))).rejects.toMatchObject({ status: 400 });
		await expect(POST(post({ ...body, projectId: 8 }))).rejects.toMatchObject({ status: 403 });
		expect(directusServerJson).not.toHaveBeenCalled();
		directusServerJson.mockRejectedValue(new Error('collection tidak ada'));
		await expect(POST(post(body))).rejects.toMatchObject({ status: 503 });
	});
});
