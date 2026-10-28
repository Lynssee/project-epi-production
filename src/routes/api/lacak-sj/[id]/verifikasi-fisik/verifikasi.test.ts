import { describe, expect, it, vi, beforeEach } from 'vitest';

const calls: { url: string; method: string; body: any }[] = [];
let sjRow: any;
let projRow: any;
let aktorMock: any;

vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn(async (url: string, opt: any = {}) => {
		const method = opt.method || 'GET';
		const body = opt.body ? JSON.parse(opt.body) : null;
		calls.push({ url, method, body });
		if (method === 'GET') {
			if (url.startsWith('/items/surat_jalan/')) return { data: sjRow };
			if (url.startsWith('/items/surat_jalan_items')) return { data: [{ id: 1, nama_barang: 'Cat A', qty_delivered: 10, unit: 'kg' }, { id: 2, nama_barang: 'Thinner', qty_delivered: 4, unit: 'L' }] };
			if (url.startsWith('/items/projects/')) return { data: projRow };
		}
		return { data: { id: 99 } };
	})
}));
vi.mock('$lib/server/sjVerifikasiAkses', async (orig) => {
	const real: any = await orig();
	return { ...real, authenticateLacakActor: vi.fn(async () => aktorMock), tanggalMulaiVerifikasi: vi.fn(async () => '2026-10-08') };
});
vi.mock('$lib/server/gerbangSj/effects', () => ({
	runEffect: async (_n: string, _id: number, fn: () => Promise<unknown>) => { try { await fn(); return null; } catch { return 'gagal'; } },
	notifyLogistik: vi.fn(async (a: any) => { calls.push({ url: '/items/app_notifications', method: 'POST', body: a }); })
}));

import { POST } from './+server';

const ev = (body: any) => ({ params: { id: '5' }, request: { json: async () => body, headers: new Headers() } }) as any;
const sesuaiSemua = { client_event_id: 'verif-abcdef12', items: [{ sj_item_id: 1, status: 'sesuai' }, { sj_item_id: 2, status: 'sesuai' }] };
const sj = (over: any = {}) => ({ id: 5, nomor_sj: 'SJ/5', project_id: 3, packing_list_id: 8, status: 'created', draft_status: null, print_count: 0, reprint_status: 'tidak_perlu', date_created: '2026-10-08T01:00:00Z', track_stage: null, pengaju_verification: null, pracetak_gudang: null, ...over });

beforeEach(() => {
	calls.length = 0;
	sjRow = sj();
	projRow = { id: 3, leader_id: 20, gr_backup_karyawan_ids: [21] };
	aktorMock = { karyawan: { id: 20, nama_karyawan: 'PL ANDI' }, projectIds: [3], isAdmin: false };
});
const status = async (p: Promise<any>) => p.then(() => 200, (e) => e?.status ?? 500);

describe('POST verifikasi-fisik (SJ-06)', () => {
	it('semua sesuai: kontrak §4.4, scan_log tanpa pindah tahap, tanpa log/notif bermasalah', async () => {
		const res: any = await POST(ev(sesuaiSemua));
		const out = await res.json();
		expect(out).toMatchObject({ ok: true, mode: 'penuh', selisih: 0, barang_bermasalah_logged: 0 });
		const patch = calls.find((c) => c.method === 'PATCH')!;
		expect(patch.body.pengaju_verification).toMatchObject({ verified_by: '20', source: 'lapangan', mode: 'penuh', self_verified: false, client_event_id: 'verif-abcdef12' });
		const scan = calls.find((c) => c.url === '/items/scan_log')!;
		expect(scan.body).toMatchObject({ stage_to: null, source: 'lapangan', client_event_id: 'verif-abcdef12' });
		expect(calls.some((c) => c.url === '/items/barang_bermasalah_log' && c.method === 'POST')).toBe(false);
		expect(calls.some((c) => c.url === '/items/app_notifications')).toBe(false);
	});
	it('idempoten: client_event_id sama → tidak menulis apa pun', async () => {
		sjRow = sj({ pengaju_verification: { verified_at: '2026-10-08T02:00:00Z', client_event_id: 'verif-abcdef12', mode: 'penuh', items: [] } });
		const out = await (await POST(ev(sesuaiSemua)) as any).json();
		expect(out.idempoten).toBe(true);
		expect(calls.some((c) => c.method !== 'GET')).toBe(false);
	});
	it('RSM-09: SJ sudah lewat gerbang (shipped) → 409, tidak menulis', async () => {
		sjRow = sj({ print_count: 1, status: 'shipped' });
		expect(await status(POST(ev(sesuaiSemua)))).toBe(409);
		expect(calls.some((c) => c.method !== 'GET')).toBe(false);
	});
	it('RSM-09: SJ sudah dicetak tapi belum lewat gerbang → boleh diverifikasi', async () => {
		sjRow = sj({ print_count: 1 });
		expect(await status(POST(ev(sesuaiSemua)))).toBe(200);
	});
	it('selisih tanpa alasan ≥ 5 huruf → 400', async () => {
		const b = { client_event_id: 'verif-xyz12345', items: [{ sj_item_id: 1, status: 'tidak_dimuat', note: 'x' }, { sj_item_id: 2, status: 'sesuai' }] };
		expect(await status(POST(ev(b)))).toBe(400);
	});
	it('SJ non-draft dengan selisih: 1 log barang bermasalah (blocker) + notifikasi gudang; K3 alasan rusak → jenis rusak', async () => {
		const b = { client_event_id: 'verif-rusak123', items: [{ sj_item_id: 1, status: 'tidak_dimuat', note: 'kaleng penyok', alasan: 'rusak' }, { sj_item_id: 2, status: 'sesuai' }] };
		const out = await (await POST(ev(b)) as any).json();
		expect(out).toMatchObject({ mode: 'parsial', selisih: 1, barang_bermasalah_logged: 1 });
		const log = calls.find((c) => c.url === '/items/barang_bermasalah_log' && c.method === 'POST')!;
		expect(log.body).toMatchObject({ jenis: 'rusak', severity: 'blocker', blocks_dispatch: true, qty: 10, packing_list_id: 8, reported_by: 20 });
		expect(calls.some((c) => c.url === '/items/app_notifications')).toBe(true);
		expect(out.langkah_berikut).toMatch(/tertahan/);
	});
	it('SJ draft dengan selisih: TIDAK membuat log barang bermasalah (koreksi di approval ERP)', async () => {
		sjRow = sj({ draft_status: 'menunggu_approval' });
		const b = { client_event_id: 'verif-draft123', items: [{ sj_item_id: 1, status: 'qty_dikoreksi', qty_confirmed: 8, note: 'kurang 2 kg' }, { sj_item_id: 2, status: 'sesuai' }] };
		const out = await (await POST(ev(b)) as any).json();
		expect(out.barang_bermasalah_logged).toBe(0);
		expect(out.langkah_berikut).toMatch(/Manager Project/);
	});
	it('self-approval: penyiap = aktor & ada PL/backup lain → 409; tanpa orang lain → diizinkan self_verified', async () => {
		sjRow = sj({ pracetak_gudang: { by: 20 } });
		expect(await status(POST(ev(sesuaiSemua)))).toBe(409);
		calls.length = 0;
		projRow = { id: 3, leader_id: 20, gr_backup_karyawan_ids: [] };
		await POST(ev(sesuaiSemua));
		expect(calls.find((c) => c.method === 'PATCH')!.body.pengaju_verification.self_verified).toBe(true);
	});
	it('aktor di luar proyek → 403', async () => {
		aktorMock = { karyawan: { id: 99, nama_karyawan: 'X' }, projectIds: [7], isAdmin: false };
		expect(await status(POST(ev(sesuaiSemua)))).toBe(403);
	});
	it('"Ubah hasil" sebelum cetak: hasil lama masuk riwayat', async () => {
		sjRow = sj({ pengaju_verification: { verified_at: '2026-10-08T02:00:00Z', verified_by_name: 'BUDI', mode: 'penuh', client_event_id: 'verif-lama0001' } });
		await POST(ev(sesuaiSemua));
		const pv = calls.find((c) => c.method === 'PATCH')!.body.pengaju_verification;
		expect(pv.riwayat[0]).toMatchObject({ verified_by_name: 'BUDI', mode: 'penuh' });
	});
});
