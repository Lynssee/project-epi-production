// WSK-10/13 — handler server laporan harian lapangan (HP): otorisasi per PO, idempoten, tanggal ganda, kompensasi, gabung.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	directus: vi.fn(),
	scope: { unrestricted: false, projectIds: [2] } as any,
	member: false
}));

vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => h.directus(...a) }));
vi.mock('$lib/server/firebaseAuth', () => ({ requireUser: async () => ({ localId: 'uid1', email: 'a@x.id' }) }));
vi.mock('$lib/server/projectLeaderGuard', () => ({ resolveKaryawanByEmail: async () => ({ id: 61, nama_karyawan: 'RIDHO' }) }));
vi.mock('$lib/server/fieldProjectScope', () => ({ resolveFieldProjectScope: async () => h.scope }));

const { handleDailyReportCreate, handleQuickReportCreate } = await import('./workshopDailyReport');

type Call = { url: string; method: string; body: any };
let calls: Call[] = [];
let created = 0;
/** Peta jawaban per awalan URL; fungsi mendapat Call. */
function mock(routes: Record<string, any>) {
	h.directus.mockImplementation(async (url: string, opt: any = {}) => {
		const method = opt.method || 'GET';
		const call = { url, method, body: opt.body ? JSON.parse(opt.body) : undefined };
		calls.push(call);
		for (const [prefix, v] of Object.entries(routes)) {
			const [m, p] = prefix.includes(' ') ? prefix.split(' ') : ['GET', prefix];
			if (m === method && url.startsWith(p)) return typeof v === 'function' ? v(call) : v;
		}
		if (method === 'POST') return { data: Array.isArray(call.body) ? call.body.map(() => ({ id: ++created })) : { id: ++created } };
		return { data: [] };
	});
}
const req = (body: any) => ({ request: { json: async () => body, headers: new Headers({ authorization: 'Bearer tok' }) } }) as any;
const body = (extra: any = {}) => ({
	clientTxnId: 'txn-abcdef12',
	header: { tanggal: '2026-10-10', catatan: 'cat' },
	absensi: [{ nama: 'Andi', status_hadir: 'hadir', manpower_id: 7, po_split: [{ po_id: 2, persentase: 100 }] }],
	absensi_leader: [{ nama: 'Budi', status_hadir: 'hadir' }],
	material: [{ nama_material: 'Cat', qty: 2 }],
	po_details: [{ po_id: 2, subtask_name: 'Blasting', volume_aktual: 5 }],
	...extra
});
const projects = { 'GET /items/projects': { data: [{ id: 2, workshop: 'ciketing' }] } };
const run = async (b: any, ws: any = 'ciketing') => {
	const res: Response = await handleDailyReportCreate(req(b), ws);
	return { status: res.status, json: await res.json() };
};
const writes = () => calls.filter((c) => c.method !== 'GET');

beforeEach(() => {
	calls = []; created = 0; h.directus.mockReset(); h.scope = { unrestricted: false, projectIds: [2] };
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('validasi & otorisasi', () => {
	it('tanpa clientTxnId → 400', async () => {
		mock({ ...projects });
		await expect(run(body({ clientTxnId: 'x' }))).rejects.toMatchObject({ status: 400 });
		expect(writes()).toHaveLength(0);
	});

	it('PO milik workshop LAIN → 400 dan tidak ada yang ditulis', async () => {
		mock({ 'GET /items/projects': { data: [{ id: 2, workshop: 'balaraja' }] } });
		await expect(run(body())).rejects.toMatchObject({ status: 400 });
		expect(writes()).toHaveLength(0);
	});

	it('PO di luar kursi proyek dan bukan anggota roster → 403 (fail-closed)', async () => {
		h.scope = { unrestricted: false, projectIds: [99] };
		mock({ ...projects });
		await expect(run(body())).rejects.toMatchObject({ status: 403 });
		expect(writes()).toHaveLength(0);
	});

	it('PO di luar kursi proyek TAPI anggota roster workshop → diizinkan', async () => {
		h.scope = { unrestricted: false, projectIds: [99] };
		mock({ ...projects, 'GET /items/workshop_project_leader': { data: [{ id: 1 }] } });
		const r = await run(body());
		expect(r.json.success).toBe(true);
	});

	it('peran penuh (unrestricted) tidak diperiksa roster', async () => {
		h.scope = { unrestricted: true };
		mock({ ...projects });
		expect((await run(body())).json.success).toBe(true);
		expect(calls.some((c) => c.url.startsWith('/items/workshop_project_leader'))).toBe(false);
	});
});

describe('penyimpanan atomik', () => {
	it('sukses: header (dibuat_oleh dari token, jumlah_tenaga server = orang unik hadir) → absensi → split → material → progres PO', async () => {
		mock({ ...projects });
		const r = await run(body());
		expect(r.json).toMatchObject({ success: true, merged: false, jumlahTenaga: 2, dibuatOleh: 'RIDHO' });
		const order = writes().map((c) => c.url.split('?')[0]);
		expect(order.slice(0, 5)).toEqual(['/items/workshop_daily_report', '/items/workshop_report_absensi', '/items/workshop_absensi_po_split', '/items/workshop_report_material', '/items/workshop_report_po_detail']);
		const header = writes()[0].body;
		expect(header).toMatchObject({ workshop_id: 1, dibuat_oleh: 'RIDHO', jumlah_tenaga: 2, sumber_data: 'sistem' });
		expect(header.catatan).toContain('[txn:txn-abcdef12]');
		expect(writes().find((c) => c.url.startsWith('/items/workshop_report_po_detail'))!.body[0]).toMatchObject({ workshop_id: 1, po_id: 2, jumlah_manpower: 1 });
		expect(r.json.manpowerForSync).toEqual([{ manpower_id: 7, status_hadir: 'hadir' }]);
	});

	it('dibuat_oleh / jumlah_tenaga kiriman klien DIABAIKAN', async () => {
		mock({ ...projects });
		await run(body({ header: { tanggal: '2026-10-10', dibuat_oleh: 'Palsu', jumlah_tenaga: 99 } }));
		const header = writes()[0].body;
		expect(header.dibuat_oleh).toBe('RIDHO');
		expect(header.jumlah_tenaga).toBe(2);
	});

	it('gagal di tengah (progres PO) → KOMPENSASI: anak & header dihapus, tidak ada laporan yatim', async () => {
		mock({ ...projects, 'POST /items/workshop_report_po_detail': () => { throw new Error('500 boom'); } });
		await expect(run(body())).rejects.toMatchObject({ status: 503 });
		const dels = writes().filter((c) => c.method === 'DELETE').map((c) => c.url);
		expect(dels).toEqual(expect.arrayContaining(['/items/workshop_absensi_po_split', '/items/workshop_report_material', '/items/workshop_report_absensi']));
		expect(dels.some((u) => /\/items\/workshop_daily_report\/\d+$/.test(u))).toBe(true);
	});

	it('kompensasi ikut gagal → pesan "hubungi admin" dengan nomor laporan (jangan kirim ulang)', async () => {
		mock({ ...projects, 'POST /items/workshop_report_po_detail': () => { throw new Error('boom'); }, 'DELETE /items/workshop_daily_report': () => { throw new Error('boom2'); } });
		await expect(run(body())).rejects.toMatchObject({ status: 503, body: { message: expect.stringContaining('JANGAN kirim ulang') } });
	});
});

describe('idempoten & tanggal ganda', () => {
	it('penanda [txn:…] sudah ada → laporan yang sama, TIDAK menulis apa pun', async () => {
		mock({ ...projects, 'GET /items/workshop_daily_report?filter[workshop_id][_eq]=1&filter[catatan]': { data: [{ id: 55 }] } });
		const r = await run(body());
		expect(r.json).toMatchObject({ success: true, idempotent: true, laporanId: 55 });
		expect(writes()).toHaveLength(0);
	});

	it("tanggal sudah ada, mode bawaan 'tolak' → 409 LAPORAN_TANGGAL_ADA dengan info laporan yang ada", async () => {
		mock({ ...projects, 'GET /items/workshop_daily_report?filter[workshop_id][_eq]=1&filter[tanggal]': { data: [{ id: 5, tanggal: '2026-10-10', dibuat_oleh: 'SITI' }] } });
		const r = await run(body());
		expect(r.status).toBe(409);
		expect(r.json).toMatchObject({ success: false, code: 'LAPORAN_TANGGAL_ADA', existing: { id: 5, dibuat_oleh: 'SITI' } });
		expect(r.json.message).toContain('SITI');
		expect(writes()).toHaveLength(0);
	});

	it("mode 'gabung': menambah ke laporan yang ada — orang & material identik dilewati, tidak membuat header baru", async () => {
		mock({
			...projects,
			'GET /items/workshop_daily_report?filter[workshop_id][_eq]=1&filter[tanggal]': { data: [{ id: 5, tanggal: '2026-10-10', dibuat_oleh: 'SITI', catatan: 'lama', kendala: '' }] },
			'GET /items/app_settings': { data: [{ setting_value: 'gabung' }] },
			'GET /items/workshop_report_absensi': { data: [{ id: 1, nama: 'Andi', tipe: 'manpower', manpower_id: 7, status_hadir: 'hadir' }] },
			'GET /items/workshop_report_material': { data: [{ id: 1, kategori: null, nama_material: 'Cat', qty: 2, satuan: null }] },
			'GET /items/workshop_report_po_detail': { data: [] }
		});
		const r = await run(body());
		expect(r.json).toMatchObject({ success: true, merged: true, laporanId: 5 });
		expect(r.json.skipped).toMatchObject({ absensi: ['Andi'], material: 1 });
		expect(writes().some((c) => c.method === 'POST' && c.url.startsWith('/items/workshop_daily_report'))).toBe(false);
		expect(writes().find((c) => c.method === 'PATCH')!.url).toBe('/items/workshop_daily_report/5');
	});
});

describe('workshop balaraja', () => {
	it('memakai workshop_id 2 dan PO bertanda workshop balaraja', async () => {
		mock({ 'GET /items/projects': { data: [{ id: 2, workshop: 'balaraja' }] } });
		await run(body(), 'balaraja');
		expect(writes()[0].body.workshop_id).toBe(2);
	});
});

describe('penjaga tanggal ganda tidak menghitung Quick Report', () => {
	it('query tanggal memuat filter "bukan [Quick Report]"', async () => {
		mock({ ...projects });
		await run(body());
		const q = calls.find((c) => c.url.startsWith('/items/workshop_daily_report?') && c.url.includes('filter[tanggal]'))!;
		expect(q.url).toContain('filter[_or][0][catatan][_null]=true');
		expect(q.url).toContain('filter[_or][1][catatan][_nstarts_with]=' + encodeURIComponent('[Quick Report]'));
	});
});

describe('Quick Report (atomik + idempoten)', () => {
	const FOTO = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
	const qbody = (extra: any = {}) => ({ clientTxnId: 'txn-quick-001', projectId: 2, aktivitas: 'Blasting sisi kiri', fotoIds: [FOTO], ...extra });
	const qrun = async (b: any, ws: any = 'ciketing') => {
		const res: Response = await handleQuickReportCreate(req(b), ws);
		return { status: res.status, json: await res.json() };
	};

	it('sukses: header (jumlah_tenaga 0, awalan [Quick Report], penanda txn, dibuat_oleh dari token, tanggal WIB server) + 1 progres PO berfoto', async () => {
		mock({ ...projects });
		const r = await qrun(qbody());
		expect(r.json).toMatchObject({ success: true, idempotent: false });
		expect(r.json.tanggal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const w = writes();
		expect(w[0].body).toMatchObject({ workshop_id: 1, jumlah_tenaga: 0, dibuat_oleh: 'RIDHO', sumber_data: 'sistem' });
		expect(w[0].body.catatan).toMatch(/^\[Quick Report\] Blasting sisi kiri\n\[txn:txn-quick-001\]$/);
		expect(w[1].url).toBe('/items/workshop_report_po_detail');
		expect(w[1].body[0]).toMatchObject({ po_id: 2, jumlah_manpower: 0, subtask_name: 'Quick Report Lapangan', foto_urls: [{ stage: null, file_id: FOTO }] });
	});

	it('TIDAK dibatasi satu per tanggal: tidak memeriksa/menolak laporan yang sudah ada hari itu', async () => {
		mock({ ...projects, 'GET /items/workshop_daily_report?filter[workshop_id][_eq]=1&filter[tanggal]': { data: [{ id: 5 }] } });
		const r = await qrun(qbody());
		expect(r.status).toBe(200);
		expect(calls.some((c) => c.url.includes('filter[tanggal]'))).toBe(false);
	});

	it('kirim ulang dengan clientTxnId sama → idempoten, tidak menulis', async () => {
		mock({ ...projects, 'GET /items/workshop_daily_report?filter[workshop_id][_eq]=1&filter[catatan]': { data: [{ id: 77 }] } });
		const r = await qrun(qbody());
		expect(r.json).toMatchObject({ success: true, idempotent: true, laporanId: 77 });
		expect(writes()).toHaveLength(0);
	});

	it('gagal simpan progres PO → header dihapus (kompensasi), tidak ada header yatim', async () => {
		mock({ ...projects, 'POST /items/workshop_report_po_detail': () => { throw new Error('500'); } });
		await expect(qrun(qbody())).rejects.toMatchObject({ status: 503 });
		expect(writes().some((c) => c.method === 'DELETE' && /\/items\/workshop_daily_report\/\d+$/.test(c.url))).toBe(true);
	});

	it('kompensasi gagal → pesan "hubungi admin" + nomor laporan', async () => {
		mock({ ...projects, 'POST /items/workshop_report_po_detail': () => { throw new Error('500'); }, 'DELETE /items/workshop_daily_report': () => { throw new Error('x'); } });
		await expect(qrun(qbody())).rejects.toMatchObject({ status: 503, body: { message: expect.stringContaining('JANGAN kirim ulang') } });
	});

	it('validasi: foto wajib, id foto harus uuid, PO wajib, catatan dibatasi', async () => {
		mock({ ...projects });
		await expect(qrun(qbody({ fotoIds: [] }))).rejects.toMatchObject({ status: 400 });
		await expect(qrun(qbody({ fotoIds: ['../../etc/passwd'] }))).rejects.toMatchObject({ status: 400 });
		await expect(qrun(qbody({ projectId: 0 }))).rejects.toMatchObject({ status: 400 });
		await expect(qrun(qbody({ aktivitas: 'x'.repeat(501) }))).rejects.toMatchObject({ status: 400 });
		await expect(qrun(qbody({ clientTxnId: 'x' }))).rejects.toMatchObject({ status: 400 });
		expect(writes()).toHaveLength(0);
	});

	it('otorisasi sama dengan laporan lengkap: PO workshop lain → 400; di luar kursi & bukan roster → 403', async () => {
		mock({ 'GET /items/projects': { data: [{ id: 2, workshop: 'balaraja' }] } });
		await expect(qrun(qbody())).rejects.toMatchObject({ status: 400 });
		h.scope = { unrestricted: false, projectIds: [99] };
		mock({ ...projects });
		await expect(qrun(qbody())).rejects.toMatchObject({ status: 403 });
		expect(writes()).toHaveLength(0);
	});

	it('balaraja memakai workshop_id 2', async () => {
		mock({ 'GET /items/projects': { data: [{ id: 2, workshop: 'balaraja' }] } });
		await qrun(qbody(), 'balaraja');
		expect(writes()[0].body.workshop_id).toBe(2);
	});
});
