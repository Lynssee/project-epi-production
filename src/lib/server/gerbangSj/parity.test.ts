// GSP-11 — uji paritas OTOMATIS (tanpa Directus live): aksi yang sama dari tiga sumber (kiosk/app/erp)
// harus menghasilkan tulisan identik. Memakai fungsi normalisasi & pembanding yang SAMA dengan skrip
// scripts/gsp11-cek-paritas.mjs (yang membandingkan data nyata di Directus). Cakupan: P1, P2, P6, P7, P8, P10, P12(sebagian).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normSj, normScan, normGateLog, normNotif, normProc, bandingkan } from '../../../../scripts/gsp11-cek-paritas.mjs';

type Store = {
	sj: any;
	scan: any[];
	gate: any[];
	notif: any[];
	proc: any[];
};
let st: Store;
const SJ_ID = 5;
const baseSj = (over: any = {}) => ({
	id: SJ_ID, nomor_sj: 'UJI-GSP-5', status: 'needs_security_check', approval_status: 'tidak_perlu', draft_status: null,
	print_count: 1, driver: 'Andi', vehicle_id: null, security_checklist: null, security_verified_at: null,
	security_verified_by: null, foto_kirim: null, gr_gps_lat: null, track_stage: null, ...over
});

vi.mock('../directus', () => ({
	directusServerUpload: vi.fn(),
	directusServerJson: vi.fn(async (url: string, opt: any = {}) => {
		const method = opt.method || 'GET';
		const body = opt.body ? JSON.parse(opt.body) : null;
		if (method === 'GET') {
			if (url.startsWith('/items/scan_log?filter[client_event_id]')) {
				const id = decodeURIComponent(url.match(/_eq\]=([^&]+)/)![1]);
				return { data: st.scan.filter((r) => r.client_event_id === id).map((r) => ({ id: 1, stage_to: r.stage_to })) };
			}
			if (url.startsWith('/items/scan_log?')) return { data: [] };
			if (url.startsWith('/files/')) return { data: { id: 'foto-1', title: 'Gerbang SJ 5 - x' } };
			if (url.startsWith('/items/surat_jalan/')) return { data: st.sj };
			if (url.startsWith('/items/surat_jalan_items')) return { data: [{ id: 11, nama_barang: 'Cat', qty_delivered: 5, jumlah_pcs: 2, unit: 'kg' }, { id: 12, nama_barang: 'Thinner', qty_delivered: 3, jumlah_pcs: 1, unit: 'ltr' }] };
			if (url.startsWith('/items/fleet_shipments')) return { data: [{ surat_jalan_id: SJ_ID, jumlah_koli: 3 }] };
			return { data: [] };
		}
		if (method === 'PATCH' && url.startsWith('/items/surat_jalan')) {
			// meniru Directus prod: hanya { query:{filter}, data } yang valid (filter di URL + body polos = 400)
			const { assertBatchPatch } = await import('../directusCasTestkit');
			const { filter, data } = assertBatchPatch(url, opt.body);
			const m = ((filter as any)?._and ?? []).find((c: any) => c?.status?._eq)?.status._eq;
			if (st.sj.status !== m) return { data: [] };
			st.sj = { ...st.sj, ...data };
			return { data: [{ id: SJ_ID }] };
		}
		if (method === 'POST') {
			if (url === '/items/scan_log') st.scan.push(body);
			else if (url === '/items/security_gate_goods_log') st.gate.push(body);
			else if (url === '/items/app_notifications') st.notif.push(body);
			else if (url === '/items/process_event_log') st.proc.push(body);
			return { data: { id: 99 } };
		}
		return { data: {} };
	})
}));
vi.mock('../sjGerbangGuard', () => ({
	evaluateGerbangMinimum: () => [],
	getGerbangBlockersDetailed: async () => ({ blockers: [], gate_check: 'ok' })
}));
vi.mock('../rangkap', () => ({ summarizeRangkapForGate: async () => ({ total: 0, wajib_kembali: 0, belum_diserahkan: [], siap: true }) }));
vi.mock('../gateDefinitionsMode', () => ({ resolveGateMode: async () => 'shadow' }));
vi.mock('../sjTracking', () => ({
	// meniru recordKioskTrackingEvent: 1 baris scan_log + cache track_stage di SJ
	recordKioskTrackingEvent: vi.fn(async (a: any) => {
		st.scan.push({ ref_id: String(a.sjId), stage_to: a.stageTo, actor_role: a.actor.role, source: a.source, notes: a.notes, client_event_id: a.clientEventId });
		st.sj = { ...st.sj, track_stage: a.stageTo };
		return { ok: true };
	})
}));

import { loloskan, tahan } from './actions';
import type { GateActor, GateSumber } from './types';

const actorOf = (sumber: GateSumber): GateActor => ({ sumber, karyawanId: 7, nama: 'BUDI', email: null, label: `${sumber.toUpperCase()}/BUDI` });
const LAYAR: GateSumber[] = ['kiosk', 'app', 'erp'];
const okBody = (id: string, extra: any = {}) => ({
	client_event_id: id, checklist: { jumlah_ok: true, plat_ok: true, driver_ok: true }, koli_dihitung: 3,
	items: [{ sj_item_id: 11, ok: true }, { sj_item_id: 12, ok: true }], foto_file_id: 'foto-1', ...extra
});

async function jalankan(aksi: 'lolos' | 'tahan', body: (l: GateSumber) => any, awal: any = {}, opts: any = {}) {
	const hasil: Record<string, any> = {};
	for (const l of LAYAR) {
		st = { sj: baseSj(awal), scan: [], gate: [], notif: [], proc: [] };
		if (aksi === 'lolos') await loloskan(SJ_ID, body(l), actorOf(l), opts);
		else await tahan(SJ_ID, body(l), actorOf(l));
		hasil[l] = { aksi, surat_jalan: normSj(st.sj), scan_log: normScan(st.scan), gate_log: normGateLog(st.gate), notif: normNotif(st.notif), process_log: normProc(st.proc) };
	}
	return bandingkan(hasil) as { bagian: string; kunci: string; sama: boolean; nilai: any }[];
}
const bedaOf = (rows: any[]) => rows.filter((r) => !r.sama).map((r) => `${r.bagian}.${r.kunci}`);

beforeEach(() => vi.clearAllMocks());

describe('GSP-11 paritas kiosk · app · erp (data tiruan)', () => {
	it('P1 Loloskan + foto: semua SAMA', async () => {
		const rows = await jalankan('lolos', (l) => okBody(`gerbang-${l}-p1aaaa`, { foto_file_id: 'foto-1', gps: { lat: -6.2, lng: 106.8, accuracy: 9 } }));
		expect(bedaOf(rows)).toEqual([]);
		expect(rows.find((r) => r.kunci === 'status')!.nilai.kiosk).toBe('"shipped"');
		expect(rows.find((r) => r.kunci === 'foto_kirim')!.nilai.app).toBe('"ada"');
		expect(rows.find((r) => r.kunci === 'draft_status')!.nilai.erp).toBe('"siap_kirim"');
	});
	it('P2 Loloskan tanpa foto: foto_kirim tidak ditulis di ketiganya', async () => {
		const rows = await jalankan('lolos', (l) => okBody(`gerbang-${l}-p2aaaa`, { foto_file_id: null }), {}, { legacy: true });
		expect(bedaOf(rows)).toEqual([]);
		expect(rows.find((r) => r.kunci === 'foto_kirim')!.nilai.kiosk).toBe('"tidak"');
	});
	it('P6 Tahan kategori Plat: semua SAMA, status & approval tidak berubah', async () => {
		const rows = await jalankan('tahan', (l) => ({ client_event_id: `gerbang-${l}-p6aaaa`, kategori: 'plat', alasan: 'Plat beda: B1 vs B2' }));
		expect(bedaOf(rows)).toEqual([]);
		expect(rows.find((r) => r.kunci === 'status')!.nilai.app).toBe('"needs_security_check"');
		expect(rows.find((r) => r.kunci === 'approval_status')!.nilai.erp).toBe('"tidak_perlu"');
		expect(rows.find((r) => r.kunci === 'track_stage')!.nilai.kiosk).toBe('null');
	});
	it('P7 Tahan lalu Loloskan (layar boleh beda): riwayat[0]=ditahan, approval tetap', async () => {
		for (const [a, b] of [['app', 'kiosk'], ['erp', 'app'], ['kiosk', 'erp']] as [GateSumber, GateSumber][]) {
			st = { sj: baseSj(), scan: [], gate: [], notif: [], proc: [] };
			await tahan(SJ_ID, { client_event_id: `gerbang-${a}-p7aaaa`, kategori: 'koli', alasan: 'Koli kurang satu' }, actorOf(a));
			await loloskan(SJ_ID, okBody(`gerbang-${b}-p7bbbb`), actorOf(b));
			const cl = st.sj.security_checklist;
			expect(st.sj.status).toBe('shipped');
			expect(st.sj.approval_status).toBe('tidak_perlu');
			expect(cl.riwayat[0]).toMatchObject({ hasil: 'ditahan', kategori: 'koli', sumber: a });
			expect(st.sj.security_verified_by).toBe(`${b.toUpperCase()}/BUDI`);
		}
	});
	it('P8 approval menunggu: Loloskan 409 BELUM_DISETUJUI di ketiganya, Tahan tetap sukses', async () => {
		for (const l of LAYAR) {
			st = { sj: baseSj({ approval_status: 'menunggu' }), scan: [], gate: [], notif: [], proc: [] };
			await expect(loloskan(SJ_ID, okBody(`gerbang-${l}-p8aaaa`), actorOf(l))).rejects.toMatchObject({ kode: 'BELUM_DISETUJUI', status: 409 });
			expect(st.sj.status).toBe('needs_security_check');
			expect(st.scan.length + st.gate.length + st.notif.length).toBe(0);
			expect((await tahan(SJ_ID, { client_event_id: `gerbang-${l}-p8bbbb`, kategori: 'dokumen', alasan: 'Menunggu approval' }, actorOf(l))).hasil).toBe('ditahan');
		}
	});
	it('P3/P4/P5 validasi sama di ketiganya dan tidak menulis apa pun', async () => {
		const kasus: [string, any][] = [
			['CEK_BELUM_LENGKAP', { checklist: { jumlah_ok: true, plat_ok: false, driver_ok: true } }],
			['ADA_SELISIH_ITEM', { items: [{ sj_item_id: 11, ok: true }, { sj_item_id: 12, ok: false }] }],
			['KOLI_BEDA', { koli_dihitung: 2 }]
		];
		for (const [kode, ubah] of kasus) for (const l of LAYAR) {
			st = { sj: baseSj(), scan: [], gate: [], notif: [], proc: [] };
			await expect(loloskan(SJ_ID, okBody(`gerbang-${l}-p345aa`, ubah), actorOf(l))).rejects.toMatchObject({ kode, status: 400 });
			expect(st.sj).toEqual(baseSj());
			expect(st.scan.length + st.gate.length + st.notif.length + st.proc.length).toBe(0);
		}
	});
	it('P9 SJ backfill: DATA_TIDAK_KONSISTEN di ketiganya', async () => {
		for (const l of LAYAR) {
			st = { sj: baseSj({ security_verified_at: '2026-09-09T13:49:17Z', security_verified_by: 'SYSTEM/BACKFILL', security_checklist: 'Diloloskan massal' }), scan: [], gate: [], notif: [], proc: [] };
			await expect(loloskan(SJ_ID, okBody(`gerbang-${l}-p9aaaa`), actorOf(l))).rejects.toMatchObject({ kode: 'DATA_TIDAK_KONSISTEN' });
		}
	});
	it('P10 klik ganda (client_event_id sama): tulis 1×, respons kedua idempoten', async () => {
		for (const l of LAYAR) {
			st = { sj: baseSj(), scan: [], gate: [], notif: [], proc: [] };
			const id = `gerbang-${l}-p10aaa`;
			const r1 = await loloskan(SJ_ID, okBody(id), actorOf(l));
			const n = { scan: st.scan.length, gate: st.gate.length, notif: st.notif.length, proc: st.proc.length };
			const r2 = await loloskan(SJ_ID, okBody(id), actorOf(l));
			expect(r1.idempoten).toBe(false);
			expect(r2).toMatchObject({ hasil: 'lolos', idempoten: true });
			expect({ scan: st.scan.length, gate: st.gate.length, notif: st.notif.length, proc: st.proc.length }).toEqual(n);
			expect(st.scan.filter((s) => s.stage_to === 'lolos_gerbang')).toHaveLength(1);
		}
	});
	it('P11 dua layar meloloskan SJ yang sama: satu menang, satu idempoten, data ditulis sekali', async () => {
		st = { sj: baseSj(), scan: [], gate: [], notif: [], proc: [] };
		const a = await loloskan(SJ_ID, okBody('gerbang-kiosk-p11aa'), actorOf('kiosk'));
		const b = await loloskan(SJ_ID, okBody('gerbang-app-p11bbb'), actorOf('app'));
		expect([a.idempoten, b.idempoten]).toEqual([false, true]);
		expect(st.gate).toHaveLength(1);
		expect(st.notif).toHaveLength(1);
		expect(st.sj.security_verified_by).toBe('KIOSK/BUDI');
	});
});
