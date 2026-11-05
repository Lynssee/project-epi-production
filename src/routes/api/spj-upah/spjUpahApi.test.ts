// GPM-C09 — endpoint SPJ Upah (lapangan): daftar, catat bukti (validasi + unggah), batalkan bukti.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/firebaseAuth', () => ({ requireUser: vi.fn(async () => ({ email: 'irfan@x.id' })) }));
vi.mock('$lib/server/manpowerLeaderGuard', () => ({ resolveManpowerByEmail: vi.fn() }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn(), directusServerUpload: vi.fn() }));
vi.mock('$lib/server/ess/time', () => ({ todayJakarta: () => '2026-10-29' }));

import { resolveManpowerByEmail } from '$lib/server/manpowerLeaderGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { GET } from './+server';
import { POST, DELETE } from './[paId]/+server';

const dx = vi.mocked(directusServerJson);
const upload = vi.mocked(directusServerUpload);
const resolve = vi.mocked(resolveManpowerByEmail);

const PA = { id: 800, nomor_pengajuan: 'PA-0800', status: 'Dibukukan', total_amount: 3_000_000, tanggal_dicairkan: '2026-10-28', penerima_dana_type: 'koordinator_upah', dynamic_fields: { koordinator_upah: { manpower_id: 5 } } };
const RINCIAN = [1, 2, 3].map((m) => ({ id: m, pengajuan_anggaran_id: 800, manpower_id: m, jumlah: 1_000_000 }));
let distribusi: any[]; let baris: any;
const panggil = (fn: any, event: any): Promise<any> => fn(event);

beforeEach(() => {
	dx.mockReset(); upload.mockReset(); resolve.mockReset();
	resolve.mockResolvedValue({ id: 5, nama: 'Irfan' } as any);
	distribusi = [];
	baris = { id: 10, pengajuan_anggaran_id: 800, dicatat_oleh_manpower_id: 5, status_verifikasi: 'menunggu' };
	dx.mockImplementation(async (u: string, init?: any) => {
		if (u.startsWith('/items/app_settings')) return { data: [] };
		if (u.startsWith('/items/pengajuan_anggaran?')) return { data: [PA] };
		if (u.startsWith('/items/pengajuan_anggaran/')) return { data: PA };
		if (u.startsWith('/items/pengajuan_anggaran_manpower')) return { data: RINCIAN };
		if (u.startsWith('/items/manpower?')) return { data: [{ id: 1, nama: 'Yusuf' }, { id: 2, nama: 'Ali' }, { id: 3, nama: 'Budi' }] };
		if (u.startsWith('/items/pengajuan_anggaran_distribusi_upah?')) return { data: distribusi };
		if (u.startsWith('/items/pengajuan_anggaran_distribusi_upah/')) return init?.method === 'DELETE' ? null : { data: baris };
		if (u === '/items/pengajuan_anggaran_distribusi_upah' && init?.method === 'POST') return { data: { id: 77 } };
		return { data: null };
	});
	upload.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { id: 'file-1' } }) } as any);
});

const formBukti = (o: Record<string, any> = {}) => {
	const fd = new FormData();
	fd.append('manpower_id', String(o.manpower_id ?? 1));
	fd.append('jumlah_diterima', String(o.jumlah ?? 1_000_000));
	fd.append('metode', o.metode ?? 'tunai');
	if (o.foto !== null) fd.append('foto', o.foto ?? new File([new Uint8Array(2000)], 'b.jpg', { type: 'image/jpeg' }));
	return fd;
};
const evPost = (fd: FormData, paId = '800') => ({ params: { paId }, url: new URL('http://x'), request: new Request('http://x', { method: 'POST', body: fd }) });

describe('GET /api/spj-upah', () => {
	it('akun belum tertaut manpower → 403 dengan arahan', async () => {
		resolve.mockResolvedValue(null);
		await expect(panggil(GET, { url: new URL('http://x'), request: new Request('http://x') })).rejects.toMatchObject({ status: 403 });
	});
	it('daftar PA koordinator dengan ringkasan per pekerja', async () => {
		const j = await (await panggil(GET, { url: new URL('http://x'), request: new Request('http://x') })).json();
		expect(j.koordinator).toEqual({ id: 5, nama: 'Irfan' });
		expect(j.pengajuan).toHaveLength(1);
		expect(j.pengajuan[0]).toMatchObject({ nomor_pengajuan: 'PA-0800', lengkap: false, batas_tanggal: '2026-10-31' });
		expect(j.pengajuan[0].pekerja.map((p: any) => p.status)).toEqual(['belum', 'belum', 'belum']);
	});
	it('gagal baca sumber → 502 dan dilog (bukan daftar kosong diam-diam)', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		dx.mockImplementation(async () => { throw new Error('403'); });
		await expect(panggil(GET, { url: new URL('http://x'), request: new Request('http://x') })).rejects.toMatchObject({ status: 502 });
		expect(err).toHaveBeenCalled();
		err.mockRestore();
	});
});

describe('POST /api/spj-upah/[paId]', () => {
	const tulis = () => dx.mock.calls.filter(([, i]: any) => i?.method === 'POST');
	it('bukti sah → foto diunggah lalu baris dibuat (server mengisi pencatat, waktu, status menunggu)', async () => {
		const res = await panggil(POST, evPost(formBukti()));
		expect(res.status).toBe(201);
		expect((await res.json()).id).toBe(77);
		expect(upload).toHaveBeenCalledOnce();
		const body = JSON.parse((tulis()[0][1] as any).body);
		expect(body).toMatchObject({ pengajuan_anggaran_id: 800, manpower_id: 1, jumlah_diterima: 1_000_000, metode: 'tunai', bukti_file_id: 'file-1', dicatat_oleh_manpower_id: 5, status_verifikasi: 'menunggu', lat: null });
		expect(typeof body.diterima_at).toBe('string');
	});
	it('bukan koordinator PA ini → 403; PA tak ada → 404', async () => {
		resolve.mockResolvedValue({ id: 6, nama: 'Lain' } as any);
		await expect(panggil(POST, evPost(formBukti()))).rejects.toMatchObject({ status: 403 });
		resolve.mockResolvedValue({ id: 5, nama: 'Irfan' } as any);
		const base = dx.getMockImplementation()!;
		dx.mockImplementation(async (u: string, i?: any) => (u.startsWith('/items/pengajuan_anggaran/') ? { data: null } : base(u, i)));
		await expect(panggil(POST, evPost(formBukti()))).rejects.toMatchObject({ status: 404 });
	});
	it('tanpa foto / pekerja di luar rincian / total melebihi → 400 dan tidak mengunggah apa pun', async () => {
		await expect(panggil(POST, evPost(formBukti({ foto: null })))).rejects.toMatchObject({ status: 400 });
		await expect(panggil(POST, evPost(formBukti({ manpower_id: 99 })))).rejects.toMatchObject({ status: 400 });
		distribusi = [{ id: 1, manpower_id: 2, jumlah_diterima: 2_800_000, status_verifikasi: 'menunggu', bukti_file_id: 'f' }];
		await expect(panggil(POST, evPost(formBukti({ jumlah: 500_000 })))).rejects.toMatchObject({ status: 400 });
		expect(upload).not.toHaveBeenCalled();
	});
	it('unggah foto gagal → 502, baris tidak dibuat; simpan gagal → 502 dan dilog', async () => {
		upload.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as any);
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(panggil(POST, evPost(formBukti()))).rejects.toMatchObject({ status: 502 });
		expect(tulis()).toHaveLength(0);
		upload.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { id: 'file-1' } }) } as any);
		const base = dx.getMockImplementation()!;
		dx.mockImplementation(async (u: string, i?: any) => { if (i?.method === 'POST') throw new Error('403'); return base(u, i); });
		await expect(panggil(POST, evPost(formBukti()))).rejects.toMatchObject({ status: 502 });
		expect(err).toHaveBeenCalled();
		err.mockRestore();
	});
});

describe('DELETE /api/spj-upah/[paId]?baris=', () => {
	const ev = (qs = '?baris=10') => ({ params: { paId: '800' }, url: new URL(`http://x/${qs}`), request: new Request('http://x', { method: 'DELETE' }) });
	it('pencatat membatalkan bukti miliknya yang belum disetujui', async () => {
		expect((await (await panggil(DELETE, ev())).json()).success).toBe(true);
		expect(dx.mock.calls.some(([u, i]: any) => u === '/items/pengajuan_anggaran_distribusi_upah/10' && i?.method === 'DELETE')).toBe(true);
	});
	it('sudah disetujui → 409; milik orang lain → 403; id salah / PA lain → 404/400', async () => {
		baris = { ...baris, status_verifikasi: 'disetujui' };
		await expect(panggil(DELETE, ev())).rejects.toMatchObject({ status: 409 });
		baris = { ...baris, status_verifikasi: 'menunggu', dicatat_oleh_manpower_id: 9 };
		await expect(panggil(DELETE, ev())).rejects.toMatchObject({ status: 403 });
		baris = { ...baris, dicatat_oleh_manpower_id: 5, pengajuan_anggaran_id: 801 };
		await expect(panggil(DELETE, ev())).rejects.toMatchObject({ status: 404 });
		await expect(panggil(DELETE, ev(''))).rejects.toMatchObject({ status: 400 });
	});
});
