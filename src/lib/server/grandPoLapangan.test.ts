// Grand PO Fase 5 — loader server + route: Directus palsu (read-only), tanpa Rupiah, 403 fail-closed.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./directus', () => ({ directusServerJson: vi.fn() }));
vi.mock('$lib/server/firebaseAuth', () => ({ requireUser: vi.fn().mockResolvedValue({ localId: 'u1', email: 'leader@x.id' }) }));
vi.mock('$lib/server/fieldProjectScope', () => ({ resolveFieldProjectScope: vi.fn() }));

import { directusServerJson } from './directus';
import { loadGrandPoLapangan } from './grandPoLapangan';
import { GET } from '../../routes/api/proyek/[project_id]/grand-po/+server';
import { POST as hintPost } from '../../routes/api/packing-list/customer-material-hint/+server';
import { resolveFieldProjectScope } from '$lib/server/fieldProjectScope';
import { findMoneyKeys } from '$lib/utils/grandPoLapangan';

const mockDx = directusServerJson as unknown as ReturnType<typeof vi.fn>;

function fake({ noPaket = false, failPath = '', memasok = 1 as number | null, tol = null as string | null, logs = [{ id: 1, product_id: 5097, qty_used: 30, satuan: 'kg' }, { id: 2, product_id: null, qty_used: 3, satuan: 'kg' }] as any[] } = {}) {
	const calls: Array<{ path: string; opts?: any }> = [];
	mockDx.mockImplementation(async (path: string, opts?: any) => {
		calls.push({ path, opts });
		if (failPath && path.includes(failPath)) throw new Error('boom 403');
		if (path.startsWith('/items/so_customer?filter[project_id]')) return { data: [{ id: 1998 }] };
		if (path.startsWith('/items/projects?filter[id][_eq]')) return { data: [{ id: 978, so_customer_id: 2000 }] };
		if (path.includes('/items/grand_po_members?filter[so_customer_id]')) return { data: noPaket ? [] : [{ id: 1, grand_po_id: 7 }] };
		if (path.startsWith('/items/grand_po?')) return { data: [{ id: 7, nama: 'Paket Gresik', nomor_gpo: 'GPO-2609-7', status: 'aktif' }] };
		if (path.includes('/items/grand_po_members?filter[grand_po_id]')) return { data: [
			{ id: 1, grand_po_id: 7, so_customer_id: 2000, peran: 'jasa', memasok_member_id: null },
			{ id: 2, grand_po_id: 7, so_customer_id: 1998, peran: 'jasa', memasok_member_id: null },
			{ id: 3, grand_po_id: 7, so_customer_id: 2001, peran: 'material', memasok_member_id: memasok },
			{ id: 4, grand_po_id: 7, so_customer_id: 4000, peran: 'material', memasok_member_id: 99 } // memasok proyek lain
		] };
		if (path.startsWith('/items/so_customer?filter[id]')) return { data: [
			{ id: 2000, nomor_so: 'SO2000', nomor_po_customer: 'Rev2-1019', project_id: 978 },
			{ id: 1998, nomor_so: 'SO1998', nomor_po_customer: '1021', project_id: 978 },
			{ id: 2001, nomor_so: 'SO2001', nomor_po_customer: '1022', project_id: null },
			{ id: 4000, nomor_so: 'SO4000', nomor_po_customer: '9999', project_id: null }
		] };
		if (path.startsWith('/items/projects?filter[id][_in]')) return { data: [{ id: 978, name: 'PLN', status: 'on progress', total_progress: 40 }] };
		if (path.startsWith('/items/project_coating_log')) return { data: logs };
		if (path.startsWith('/items/app_settings')) return { data: tol === null ? [] : [{ setting_value: tol }] };
		if (path.startsWith('/items/so_customer_details')) return { data: [{ id: 5097, product_id: 22380, so_customer_id: 2001, nama_barang: 'BROWN 130', qty: 16, jumlah_pcs: 20, packing: 'kg' }] };
		if (path.startsWith('/items/surat_jalan?')) return { data: [{ id: 30, so_customer_id: 2001, nomor_sj: 'SJ30', status: 'shipped', track_stage: 'dalam_perjalanan', date_created: '2026-09-25T01:00:00Z' }] };
		if (path.startsWith('/items/surat_jalan_items')) return { data: [{ id: 1, surat_jalan_id: 30, so_detail_id: 5097, qty_delivered: 100, qty_gr_received: 0, cancelled_at: null }] };
		throw new Error('Path tak dikenal: ' + path);
	});
	return calls;
}

beforeEach(() => vi.clearAllMocks());

describe('loadGrandPoLapangan', () => {
	it('proyek bukan anggota Grand PO → kosong (tanpa query material)', async () => {
		const calls = fake({ noPaket: true });
		const r = await loadGrandPoLapangan(978);
		expect(r.paket).toEqual([]);
		expect(r.material).toEqual([]);
		expect(calls.some((c) => c.path.startsWith('/items/surat_jalan'))).toBe(false);
	});

	it('paket + material: hanya material yang memasok proyek ini; qty & status SJ; estimasi tanpa tanggal karangan', async () => {
		fake();
		const r = await loadGrandPoLapangan(978);
		expect(r.paket).toHaveLength(1);
		expect(r.paket[0].anggota.map((a) => a.so_id)).toEqual([1998, 2000, 2001, 4000]); // PO proyek ini dulu, lalu urut nomor PO
		expect(r.paket[0].anggota.find((a) => a.so_id === 2000)).toMatchObject({ proyek_ini: true, progres_pct: 40 });
		expect(r.material).toHaveLength(1); // SO 4000 memasok member 99 (bukan proyek ini) → tidak ikut
		const m = r.material[0];
		expect(m.nomor_po).toBe('1022');
		expect(m.items[0]).toMatchObject({ qty_pesan: 320, qty_kirim: 100, qty_belum: 220 });
		expect(m.surat_jalan[0]).toMatchObject({ nomor_sj: 'SJ30', status: 'dalam_perjalanan' });
		expect(m.estimasi_tiba).toContain('perjalanan');
		expect(m.memasok_belum_ditentukan).toBe(false);
	});

	it('material tanpa memasok_member_id → tetap tampil dengan tanda "belum ditentukan"', async () => {
		fake({ memasok: null });
		const r = await loadGrandPoLapangan(978);
		expect(r.material.find((m) => m.so_id === 2001)?.memasok_belum_ditentukan).toBe(true);
	});

	it('hasil TIDAK memuat kunci Rupiah dan semua request Directus adalah GET', async () => {
		fake();
		const r = await loadGrandPoLapangan(978);
		expect(findMoneyKeys({ paket: r.paket, material: r.material })).toEqual([]);
		for (const [, opts] of mockDx.mock.calls) expect(opts?.method || 'GET').toBe('GET');
	});

	it('gagal menentukan keanggotaan paket → LEMPAR (bukan dianggap "tidak ada paket")', async () => {
		fake({ failPath: 'grand_po_members?filter[so_customer_id]' });
		await expect(loadGrandPoLapangan(978)).rejects.toThrow('boom');
	});

	it('gagal di bagian pendukung (Surat Jalan) → warnings, bukan diam-diam kosong', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		fake({ failPath: '/items/surat_jalan?' });
		const r = await loadGrandPoLapangan(978);
		expect(r.warnings.join(' ')).toContain('Surat Jalan material gagal dimuat');
		expect(r.material[0].surat_jalan).toEqual([]);
		err.mockRestore();
	});
});

describe('GET /api/proyek/[project_id]/grand-po', () => {
	const ev = (id: string) => ({ params: { project_id: id }, request: { headers: new Headers({ authorization: 'Bearer tok' }) } }) as any;

	it('id tidak valid → 400', async () => {
		expect((await GET(ev('abc'))).status).toBe(400);
	});

	it('bukan pemegang proyek → 403 (fail-closed), data tidak dimuat', async () => {
		(resolveFieldProjectScope as any).mockResolvedValue({ unrestricted: false, projectIds: [1, 2] });
		fake();
		const res = await GET(ev('978'));
		expect(res.status).toBe(403);
		expect(mockDx).not.toHaveBeenCalled();
	});

	it('pemegang proyek & role penuh → 200; respons tanpa Rupiah', async () => {
		fake();
		(resolveFieldProjectScope as any).mockResolvedValue({ unrestricted: false, projectIds: [978] });
		const res = await GET(ev('978'));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.paket).toHaveLength(1);
		expect(findMoneyKeys(body)).toEqual([]);
		(resolveFieldProjectScope as any).mockResolvedValue({ unrestricted: true });
		expect((await GET(ev('978'))).status).toBe(200);
	});

	it('kegagalan loader → 502 dengan pesan generik', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		fake({ failPath: 'grand_po_members?filter[so_customer_id]' });
		(resolveFieldProjectScope as any).mockResolvedValue({ unrestricted: true });
		const res = await GET(ev('978'));
		expect(res.status).toBe(502);
		err.mockRestore();
	});
});

describe('Fase 6 — rekonsiliasi di loader', () => {
	it('rekonsiliasi memakai coating log proyek ini; log tanpa produk dihitung terpisah; pilihan_produk tersedia', async () => {
		fake({ logs: [{ id: 1, product_id: 22380, qty_used: 30, satuan: 'kg' }, { id: 2, product_id: null, qty_used: 3, satuan: 'kg' }] });
		const r = await loadGrandPoLapangan(978);
		expect(r.pilihan_produk).toEqual([{ product_id: 22380, nama_barang: 'BROWN 130', unit: '' }].map((p) => ({ ...p, unit: 'kg' })));
		expect(r.rekonsiliasi?.baris[0]).toMatchObject({ product_id: 22380, qty_pesan: 320, qty_kirim: 100, qty_dipakai: 30, qty_sisa: 70, level: 'ok' });
		expect(r.rekonsiliasi?.tanpa_produk).toBe(1);
		expect(r.rekonsiliasi?.toleransi_pct).toBe(5);
		expect(findMoneyKeys({ r: r.rekonsiliasi, p: r.pilihan_produk })).toEqual([]);
	});

	it('toleransi dibaca dari setelan admin bila ada', async () => {
		fake({ tol: '12' });
		expect((await loadGrandPoLapangan(978)).rekonsiliasi?.toleransi_pct).toBe(12);
	});

	it('coating log gagal dibaca → rekonsiliasi null + warning (BUKAN dipakai=0 palsu)', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		fake({ failPath: '/items/project_coating_log' });
		const r = await loadGrandPoLapangan(978);
		expect(r.rekonsiliasi).toBeNull();
		expect(r.warnings.join(' ')).toContain('coating log gagal dimuat');
		expect(r.pilihan_produk).toHaveLength(1); // dropdown tetap tersedia
		err.mockRestore();
	});

	it('tanpa material → rekonsiliasi null & pilihan kosong', async () => {
		fake({ noPaket: true });
		const r = await loadGrandPoLapangan(978);
		expect(r.rekonsiliasi).toBeNull();
		expect(r.pilihan_produk).toEqual([]);
	});
});

describe('POST /api/packing-list/customer-material-hint (shadow)', () => {
	const ev = (body: any) => ({ request: { headers: new Headers({ authorization: 'Bearer tok' }), json: async () => body } }) as any;

	it('barang PL yang juga ada di PO material → hits; tidak pernah memblokir; tercatat di log shadow', async () => {
		fake();
		(resolveFieldProjectScope as any).mockResolvedValue({ unrestricted: false, projectIds: [978] });
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		const res = await hintPost(ev({ projectId: 978, names: ['0x-515 brown 130', 'Sarung tangan'] }));
		const b = await res.json();
		expect(res.status).toBe(200);
		expect(b.mode).toBe('shadow');
		expect(b.hits).toHaveLength(1);
		expect(b.hits[0].produk_po).toBe('BROWN 130');
		expect(info.mock.calls[0][0]).toContain('[shadow][G_PKL_CUSTOMER_MATERIAL]');
		info.mockRestore();
	});

	it('bukan pemegang proyek → hits kosong (tanpa membocorkan data), tanpa query Directus', async () => {
		fake();
		(resolveFieldProjectScope as any).mockResolvedValue({ unrestricted: false, projectIds: [1] });
		const b = await (await hintPost(ev({ projectId: 978, names: ['BROWN 130'] }))).json();
		expect(b.hits).toEqual([]);
		expect(mockDx).not.toHaveBeenCalled();
	});

	it('projectId tidak valid → 400; names kosong → hits kosong; loader gagal → unavailable (bukan error)', async () => {
		expect((await hintPost(ev({ projectId: 'x', names: ['a'] }))).status).toBe(400);
		expect((await (await hintPost(ev({ projectId: 978, names: [] }))).json()).hits).toEqual([]);
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		fake({ failPath: 'grand_po_members?filter[so_customer_id]' });
		(resolveFieldProjectScope as any).mockResolvedValue({ unrestricted: true });
		const res = await hintPost(ev({ projectId: 978, names: ['BROWN 130'] }));
		expect(res.status).toBe(200);
		expect((await res.json()).unavailable).toBe(true);
		err.mockRestore();
	});
});
