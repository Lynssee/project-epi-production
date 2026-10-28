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
			if (url.startsWith('/items/app_settings')) return { data: [{ setting_key: 'gerbang_penjualan_aktif', setting_value: 'true' }] };
			if (url.startsWith('/items/scan_log?filter[client_event_id]')) return { data: priorScan };
			if (url.startsWith('/items/surat_jalan/')) return { data: sjRow };
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
vi.mock('../sjGerbangGuard', () => ({ evaluateGerbangMinimum: () => [], getGerbangBlockersDetailed: async () => ({ blockers: [], gate_check: 'ok' }) }));
vi.mock('../rangkap', () => ({ summarizeRangkapForGate: async () => null }));
vi.mock('../gateDefinitionsMode', () => ({ resolveGateMode: async () => 'shadow' }));
vi.mock('../sjTracking', () => ({
	recordKioskTrackingEvent: vi.fn(async (a: any) => { calls.push({ url: 'tracking', method: 'CALL', body: a }); return { ok: true }; })
}));

import { loloskanPenjualan, tahanPenjualan } from './actions';
import { GateError, type GateActor } from './types';

const actor: GateActor = { sumber: 'kiosk', karyawanId: 7, nama: 'BUDI', email: null, label: 'KIOSK/BUDI' };
const sj = (over: any = {}) => ({
	id: 9, nomor_sj: 'SJ/9', type: 'so_delivery', status: 'delivered', track_stage: null, security_verified_at: null,
	security_checklist: null, driver: 'Andi', project_id: null, ...over
});
const body = { client_event_id: 'gerbang-abcdef12', kategori: 'plat', alasan: 'Plat truk beda dengan SJ' };

beforeEach(() => { calls.length = 0; sjRow = sj(); priorScan = []; patchRows = [{ id: 9 }]; });

describe('tahanPenjualan (SJ-09 opsi C)', () => {
	it('mencatat penahanan: CAS tanpa mengubah status / security_verified_*, scan_log tanpa tahap, notif high', async () => {
		const r = await tahanPenjualan(9, body, actor);
		expect(r).toMatchObject({ ok: true, hasil: 'ditahan', idempoten: false, sj: { status: 'delivered' } });
		const patch = calls.find((c) => c.method === 'PATCH')!;
		expect(patch.url).toBe('/items/surat_jalan');
		expect(patch.body.query.filter._and).toEqual(expect.arrayContaining([{ track_stage: { _null: true } }, { security_verified_at: { _null: true } }]));
		expect(patch.body.data).not.toHaveProperty('status');
		expect(patch.body.data).not.toHaveProperty('security_verified_at');
		expect(patch.body.data.security_checklist).toMatchObject({ hasil: 'ditahan', jalur: 'penjualan', kategori: 'plat', oleh_id: 7 });
		const scan = calls.find((c) => c.url === '/items/scan_log' && c.method === 'POST')!;
		expect(scan.body.stage_to).toBeNull();
		const notif = calls.find((c) => c.url === '/items/app_notifications');
		expect(notif).toBeTruthy();
	});
	it('alasan < 5 karakter ditolak sebelum menulis apa pun', async () => {
		await expect(tahanPenjualan(9, { ...body, alasan: 'x' }, actor)).rejects.toBeInstanceOf(GateError);
		expect(calls.some((c) => c.method !== 'GET')).toBe(false);
	});
	it('SJ yang sudah dicatat lolos tidak bisa ditahan', async () => {
		sjRow = sj({ track_stage: 'lolos_gerbang' });
		await expect(tahanPenjualan(9, body, actor)).rejects.toMatchObject({ kode: 'TIDAK_BISA_DITAHAN' });
	});
	it('bukan SJ penjualan ditolak', async () => {
		sjRow = sj({ type: null });
		await expect(tahanPenjualan(9, body, actor)).rejects.toMatchObject({ kode: 'TIDAK_BISA_DITAHAN' });
	});
	it('client_event_id sudah ada → idempoten, tanpa tulis', async () => {
		priorScan = [{ id: 1, stage_to: null }];
		const r = await tahanPenjualan(9, body, actor);
		expect(r).toMatchObject({ hasil: 'ditahan', idempoten: true });
		expect(calls.some((c) => c.method !== 'GET')).toBe(false);
	});
	it('balapan: CAS kosong → STATUS_BERUBAH', async () => {
		patchRows = [];
		await expect(tahanPenjualan(9, body, actor)).rejects.toMatchObject({ kode: 'STATUS_BERUBAH' });
	});
	it('SJ proyek ikut memberi tahu admin proyek (notifikasi kedua)', async () => {
		sjRow = sj({ project_id: 3 });
		await tahanPenjualan(9, body, actor);
		expect(calls.filter((c) => c.url === '/items/app_notifications')).toHaveLength(2);
	});
});

describe('loloskanPenjualan setelah ditahan', () => {
	it('tetap bisa dicatat lolos; riwayat penahanan terbawa; status tidak diubah', async () => {
		sjRow = sj({ security_checklist: { versi: 2, hasil: 'ditahan', alasan: 'Plat beda', oleh_nama: 'BUDI', waktu: '2026-10-08T01:00:00Z' } });
		const r = await loloskanPenjualan(9, { client_event_id: 'gerbang-zzzzzzzz1' }, actor);
		expect(r).toMatchObject({ hasil: 'lolos', idempoten: false, sj: { status: 'delivered', track_stage: 'lolos_gerbang' } });
		const patch = calls.find((c) => c.method === 'PATCH')!;
		expect(patch.body.data).not.toHaveProperty('status');
		expect(patch.body.data.security_checklist.riwayat.length).toBeGreaterThan(0);
	});
});
