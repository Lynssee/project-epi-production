// RSM-08 — SJ yang sudah DICETAK tapi tidak discan muat tetap masuk antrean satpam & bisa diloloskan.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GateActor } from './types';

type Call = { path: string; method: string; body: any };
const calls: Call[] = [];
let sjCreated: any;
let sjNeeds: any[] = [];

const sjRow = (o: any = {}) => ({
	id: 11, nomor_sj: 'SJ/261024/001', status: 'created', print_count: 1, type: 'proyek', category: 29, approval_status: 'tidak_perlu',
	draft_status: null, driver: 'Andi', vehicle_id: null, security_checklist: null, security_verified_at: null, security_verified_by: null,
	foto_kirim: null, track_stage: null, project_id: 5, date_created: new Date().toISOString(), ...o
});

vi.mock('../directus', () => ({
	directusServerUpload: vi.fn(),
	directusServerJson: vi.fn(async (path: string, opts: any = {}) => {
		const method = opts?.method || 'GET';
		const body = opts?.body ? JSON.parse(opts.body) : null;
		calls.push({ path, method, body });
		if (method === 'GET') {
			if (path.startsWith('/items/app_settings')) return { data: [] };
			if (path.startsWith('/items/surat_jalan_category_config')) return { data: [{ id: 1, kode: 'OUT-06' }] };
			if (path.startsWith('/items/stock_activity_types')) return { data: [{ id: 29, code: 'OUT-06' }] };
			if (path.startsWith('/items/surat_jalan?filter[status][_eq]=needs_security_check')) return { data: sjNeeds };
			if (path.startsWith('/items/surat_jalan?filter[status][_eq]=created')) return { data: [sjCreated] };
			if (path.startsWith('/items/surat_jalan/')) return { data: sjCreated };
			if (path.startsWith('/items/scan_log?filter[client_event_id]')) return { data: [] };
			if (path.startsWith('/items/surat_jalan_items')) return { data: [{ id: 21, nama_barang: 'Cat', qty_delivered: 2, jumlah_pcs: 2, unit: 'kg' }] };
			if (path.startsWith('/items/fleet_shipments')) return { data: [{ surat_jalan_id: 11, jumlah_koli: 2 }] };
			if (path.startsWith('/files/')) return { data: { id: 'foto-1', title: 'Gerbang SJ 11 - x' } };
			return { data: [] };
		}
		if (method === 'PATCH') return { data: [{ id: 11 }] };
		return { data: { id: 99 } };
	})
}));
vi.mock('../sjGerbangGuard', async (orig) => ({
	...(await orig<typeof import('../sjGerbangGuard')>()),
	getGerbangBlockersDetailed: async () => ({ blockers: [], gate_check: 'ok' })
}));
const muat = vi.fn(async () => ({ ok: true }));
vi.mock('../sjTracking', () => ({ recordKioskTrackingEvent: (i: any) => muat(i) }));
const audit = vi.fn(async () => {});
vi.mock('../gates/gateAudit', () => ({ writeGateAudit: (p: any) => audit(p) }));
vi.mock('../gateEnforcement', () => ({ getFieldGateMode: vi.fn(async () => 'shadow') }));
vi.mock('./effects', async (orig) => {
	const real = await orig<typeof import('./effects')>();
	return {
		...real,
		checkPatrolActiveToday: async () => null,
		checkP2hVehicleToday: async () => null,
		recordLolos: vi.fn(async () => {}),
		writeGateGoodsLog: vi.fn(async () => {}),
		notifyLogistik: vi.fn(async () => {}),
		notifyProject: vi.fn(async () => {}),
		logProcess: vi.fn(async () => {})
	};
});

const { evaluatePass, siapUntukGerbang, assertBisaDitahan } = await import('./rules');
const { getAntrian } = await import('./query');
const { loloskan } = await import('./actions');

const actor: GateActor = { sumber: 'kiosk', karyawanId: 4, nama: 'Satpam A', email: null, label: 'KIOSK/Satpam A' };

beforeEach(() => {
	calls.length = 0;
	sjNeeds = [];
	sjCreated = sjRow();
	muat.mockClear();
	audit.mockClear();
});

describe('aturan murni', () => {
	it("'created' hanya siap bila sudah dicetak", () => {
		expect(siapUntukGerbang({ status: 'created', print_count: 1 })).toBe(true);
		expect(siapUntukGerbang({ status: 'created', print_count: 0 })).toBe(false);
		expect(siapUntukGerbang({ status: 'needs_security_check', print_count: 0 })).toBe(true);
		expect(siapUntukGerbang({ status: 'shipped', print_count: 3 })).toBe(false);
	});
	it('evaluatePass: created+tercetak boleh lolos; created belum cetak diblok; tahan boleh untuk created', () => {
		expect(evaluatePass({ status: 'created', print_count: 1 }).can_pass).toBe(true);
		expect(evaluatePass({ status: 'created', print_count: 0 }).blockers[0].kode).toBe('BELUM_SIAP_GERBANG');
		expect(() => assertBisaDitahan('created')).not.toThrow();
		expect(() => assertBisaDitahan('shipped')).toThrow();
	});
});

describe('antrean', () => {
	it('SJ kategori wajib-satpam yang created+tercetak muncul berlabel belum_discan_muat', async () => {
		const r = await getAntrian();
		expect(r.count).toBe(1);
		expect(r.antrian[0]).toMatchObject({ id: 11, belum_discan_muat: true, can_pass: true });
	});
	it('SJ penjualan (so_delivery) dan kategori tanpa satpam tidak ikut', async () => {
		sjCreated = sjRow({ type: 'so_delivery' });
		expect((await getAntrian()).count).toBe(0);
		sjCreated = sjRow({ category: 99 });
		expect((await getAntrian()).count).toBe(0);
	});
	it('query created memakai jendela tanggal (tidak menampilkan SJ lama)', async () => {
		await getAntrian();
		const q = calls.find((c) => c.path.startsWith('/items/surat_jalan?filter[status][_eq]=created'))!;
		expect(q.path).toContain('filter[print_count][_gt]=0');
		expect(q.path).toContain('filter[date_created][_gte]=');
	});
});

describe('loloskan SJ created', () => {
	it('mencatat dimuat otomatis, CAS mengikuti status created, hasil shipped, stok tidak disentuh, audit shadow', async () => {
		const r = await loloskan(11, { client_event_id: 'evt-12345678', checklist: { jumlah_ok: true, plat_ok: true, driver_ok: true }, koli_dihitung: 2, items: [{ sj_item_id: 21, ok: true }], foto_file_id: 'foto-1' }, actor);
		expect(r).toMatchObject({ hasil: 'lolos', idempoten: false });
		const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/items/surat_jalan')!;
		expect(patch.body.query.filter._and.find((c: any) => c.status).status._eq).toBe('created');
		expect(patch.body.data.status).toBe('shipped');
		expect(muat).toHaveBeenCalledWith(expect.objectContaining({ stageTo: 'dimuat', clientEventId: 'evt-12345678-muat' }));
		expect(audit).toHaveBeenCalledWith(expect.objectContaining({ gate: 'G_SJ_MUAT_DISCAN', decision: 'shadow' }));
		expect(calls.some((c) => c.path.includes('stock_transactions') || c.path.includes('project_stock_ledger'))).toBe(false);
	});
});
