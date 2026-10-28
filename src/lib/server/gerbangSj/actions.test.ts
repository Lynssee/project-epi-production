import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: { url: string; method: string; body: any }[] = [];
let sjRow: any;
let priorScan: any[] = [];
let patchRows: any[] = [{ id: 1 }];

vi.mock('../directus', () => ({
	directusServerUpload: vi.fn(),
	directusServerJson: vi.fn(async (url: string, opt: any = {}) => {
		const method = opt.method || 'GET';
		const body = opt.body ? JSON.parse(opt.body) : null;
		calls.push({ url, method, body });
		if (method === 'GET') {
			if (url.startsWith('/items/scan_log?filter[client_event_id]')) return { data: priorScan };
			if (url.startsWith('/items/surat_jalan/')) return { data: sjRow };
			if (url.startsWith('/items/surat_jalan_items')) return { data: [{ id: 11, nama_barang: 'Cat', qty_delivered: 5, jumlah_pcs: 2, unit: 'kg' }] };
			if (url.startsWith('/files/')) return { data: { id: 'foto-123', title: 'Gerbang SJ 5 - Muatan' } };
			return { data: [] };
		}
		if (method === 'PATCH' && url.startsWith('/items/surat_jalan')) {
			// meniru Directus prod: filter di URL + body polos = 400 "data is required"; hanya { query:{filter}, data } yang valid
			const { assertBatchPatch } = await import('../directusCasTestkit');
			assertBatchPatch(url, opt.body);
			return { data: patchRows };
		}
		return { data: { id: 99 } };
	})
}));
vi.mock('../sjGerbangGuard', () => ({
	evaluateGerbangMinimum: () => [],
	getGerbangBlockersDetailed: async () => ({ blockers: [], gate_check: 'ok' })
}));
vi.mock('../rangkap', () => ({ summarizeRangkapForGate: async () => ({ total: 0, wajib_kembali: 0, belum_diserahkan: [], siap: true }) }));
vi.mock('../gateDefinitionsMode', () => ({ resolveGateMode: async () => 'shadow' }));
vi.mock('../sjTracking', () => ({
	recordKioskTrackingEvent: vi.fn(async (a: any) => {
		calls.push({ url: 'tracking', method: 'CALL', body: a });
		return { ok: true };
	})
}));

import { loloskan, tahan } from './actions';
import { GateError, type GateActor } from './types';

const actor: GateActor = { sumber: 'app', karyawanId: 7, nama: 'BUDI', email: 'b@x', label: 'APP/BUDI' };
const sj = (over: any = {}) => ({
	id: 5, nomor_sj: 'SJ/5', status: 'needs_security_check', approval_status: 'disetujui', print_count: 1, driver: 'Andi',
	vehicle_id: null, security_checklist: null, security_verified_at: null, ...over
});
const okBody = { client_event_id: 'gerbang-abcdef12', checklist: { jumlah_ok: true, plat_ok: true, driver_ok: true }, koli_dihitung: 2, items: [{ sj_item_id: 11, ok: true }], foto_file_id: 'foto-123' };

beforeEach(() => {
	calls.length = 0;
	sjRow = sj();
	priorScan = [];
	patchRows = [{ id: 5 }];
});

describe('loloskan', () => {
	it('sukses: PATCH CAS dulu, TIDAK menulis gr_gps_*, lalu tahap/gate log/notif/process log', async () => {
		const r = await loloskan(5, { ...okBody, gps: { lat: -6.2, lng: 106.8, accuracy: 10 } }, actor);
		expect(r).toMatchObject({ ok: true, hasil: 'lolos', idempoten: false, sj: { status: 'shipped', track_stage: 'lolos_gerbang' } });
		const patch = calls.find((c) => c.method === 'PATCH')!;
		expect(patch.url).toBe('/items/surat_jalan');
		expect(patch.body.query.filter._and).toEqual([{ id: { _eq: 5 } }, { status: { _eq: 'needs_security_check' } }]);
		expect(patch.body.data).toMatchObject({ status: 'shipped', draft_status: 'siap_kirim', security_verified_by: 'APP/BUDI' });
		expect(patch.body.data.security_checklist).toMatchObject({ versi: 2, hasil: 'lolos', sumber: 'app', oleh_id: 7, koli_dihitung: 2 });
		expect(patch.body.data).not.toHaveProperty('gr_gps_lat');
		expect(calls.some((c) => c.url === 'tracking')).toBe(true);
		const posted = calls.filter((c) => c.method === 'POST').map((c) => c.url);
		expect(posted).toEqual(expect.arrayContaining(['/items/security_gate_goods_log', '/items/app_notifications', '/items/process_event_log']));
		const gl = calls.find((c) => c.url === '/items/security_gate_goods_log')!;
		expect(gl.body.satpam_pencatat_id).toBe(7);
	});
	it('client_event_id sudah ada → idempoten, tidak menulis apa pun', async () => {
		priorScan = [{ id: 1, stage_to: 'lolos_gerbang' }];
		const r = await loloskan(5, okBody, actor);
		expect(r).toMatchObject({ hasil: 'lolos', idempoten: true });
		expect(calls.some((c) => c.method !== 'GET')).toBe(false);
	});
	it('SJ sudah shipped → idempoten (balapan dua layar)', async () => {
		sjRow = sj({ status: 'shipped', security_verified_by: 'KIOSK/ANI' });
		const r = await loloskan(5, { ...okBody, client_event_id: 'gerbang-lain-0001' }, actor);
		expect(r).toMatchObject({ hasil: 'lolos', idempoten: true });
		expect(r.pesan).toContain('KIOSK/ANI');
	});
	it('CAS kalah (0 baris) lalu status sudah lolos → idempoten; selain itu STATUS_BERUBAH', async () => {
		patchRows = [];
		await expect(loloskan(5, okBody, actor)).rejects.toMatchObject({ kode: 'STATUS_BERUBAH', status: 409 });
	});
	it('approval menunggu → 409 BELUM_DISETUJUI, tidak menulis', async () => {
		sjRow = sj({ approval_status: 'menunggu' });
		await expect(loloskan(5, okBody, actor)).rejects.toMatchObject({ kode: 'BELUM_DISETUJUI', status: 409 });
		expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
	});
	it('cek tidak lengkap → 400 CEK_BELUM_LENGKAP', async () => {
		await expect(loloskan(5, { ...okBody, checklist: { jumlah_ok: true, plat_ok: false, driver_ok: true } }, actor)).rejects.toBeInstanceOf(GateError);
	});
	it('legacy: tanpa koli_dihitung & items tetap boleh', async () => {
		const r = await loloskan(5, { client_event_id: 'app-gate-5-xx', checklist: okBody.checklist, foto_file_id: 'foto-123' }, actor, { legacy: true });
		expect(r.hasil).toBe('lolos');
	});
	it('foto gerbang kosong saat foto_wajib aktif → 400 FOTO_GERBANG_WAJIB', async () => {
		await expect(loloskan(5, { ...okBody, foto_file_id: null }, actor)).rejects.toMatchObject({
			kode: 'FOTO_GERBANG_WAJIB',
			status: 400
		});
	});
});

describe('tahan', () => {
	const body = { client_event_id: 'gerbang-tahan001', alasan: 'Plat beda: B1 vs B2', kategori: 'plat' };
	it('sukses: hanya security_checklist, status/approval tidak disentuh, scan_log tanpa stage_to', async () => {
		const r = await tahan(5, body, actor);
		expect(r).toMatchObject({ hasil: 'ditahan', idempoten: false });
		const patch = calls.find((c) => c.method === 'PATCH')!;
		expect(patch.body.query.filter._and).toEqual([{ id: { _eq: 5 } }, { status: { _eq: 'needs_security_check' } }]);
		expect(Object.keys(patch.body.data)).toEqual(['security_checklist']);
		expect(patch.body.data.security_checklist).toMatchObject({ hasil: 'ditahan', ditahan: true, kategori: 'plat', oleh_id: 7 }); // ditahan:true = kompat badge ERP lama
		const scan = calls.find((c) => c.url === '/items/scan_log' && c.method === 'POST')!;
		expect(scan.body).toMatchObject({ stage_to: null, actor_role: 'satpam', source: 'lapangan' });
		expect(scan.body.notes).toMatch(/^DITAHAN/);
		expect(calls.find((c) => c.url === '/items/app_notifications')!.body.priority).toBe('high');
	});
	it('SJ shipped → 409 TIDAK_BISA_DITAHAN', async () => {
		sjRow = sj({ status: 'shipped' });
		await expect(tahan(5, body, actor)).rejects.toMatchObject({ kode: 'TIDAK_BISA_DITAHAN' });
	});
	it('checklist backfill berupa TEKS tidak rusak: riwayat aman, bukan objek per huruf', async () => {
		sjRow = sj({ security_checklist: 'Diloloskan massal backfill' });
		await tahan(5, body, actor);
		const cl = calls.find((c) => c.method === 'PATCH')!.body.data.security_checklist;
		expect(Object.keys(cl)).not.toContain('0');
		expect(cl.riwayat).toEqual([]);
	});
	it('GSP-06 K1: SJ proyek → notifikasi kedua untuk tim proyek; SJ tanpa proyek hanya logistik', async () => {
		sjRow = sj({ project_id: 15 });
		await tahan(5, body, actor);
		const notifs = calls.filter((c) => c.url === '/items/app_notifications').map((c) => c.body);
		expect(notifs.map((n) => n.department).sort()).toEqual(['logistik', 'project']);
		expect(notifs.find((n) => n.department === 'project')).toMatchObject({ module: 'project', priority: 'high', action_required: true });

		calls.length = 0;
		sjRow = sj({ project_id: null });
		await tahan(5, { ...body, client_event_id: 'gerbang-tahan003' }, actor);
		expect(calls.filter((c) => c.url === '/items/app_notifications')).toHaveLength(1);
	});
	it('Tahan tidak diblokir approval menunggu (selalu tersedia)', async () => {
		sjRow = sj({ approval_status: 'menunggu' });
		expect((await tahan(5, body, actor)).hasil).toBe('ditahan');
	});
	it('tahan setelah tahan: hasil sebelumnya masuk riwayat', async () => {
		sjRow = sj({ security_checklist: { versi: 2, hasil: 'ditahan', kategori: 'koli', alasan: 'kurang', oleh_nama: 'ANI', riwayat: [] } });
		await tahan(5, { ...body, client_event_id: 'gerbang-tahan002' }, actor);
		const cl = calls.find((c) => c.method === 'PATCH')!.body.data.security_checklist;
		expect(cl.riwayat[0]).toMatchObject({ hasil: 'ditahan', kategori: 'koli', oleh_nama: 'ANI' });
	});
});
