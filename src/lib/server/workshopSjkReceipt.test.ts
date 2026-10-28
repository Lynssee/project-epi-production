// src/lib/server/workshopSjkReceipt.test.ts
// Serah-terima digital SJ Keluar Workshop (R7 Ciketing; Fase 7 menambah Balaraja) + parser QR BLJ-SJK-V2.
// WSK-14: token QR wajib (anti-IDOR), gate approval/satpam, status terkirim, semua baris, PATCH bersyarat, scan_log wajib.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ directus: vi.fn(), modes: {} as Record<string, string> }));
vi.mock('$lib/server/firebaseAuth', () => ({ requireUser: async () => ({ localId: 'u1', email: 'a@b.c' }) }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => h.directus(...a) }));
vi.mock('$lib/server/gateDefinitionsMode', () => ({ resolveGateMode: async (key: string) => h.modes[key] ?? 'soft' }));
vi.mock('$lib/server/ess/karyawan', () => ({ resolveKaryawanByEmail: async () => ({ id: 42, nama_karyawan: 'Budi Penerima' }) }));
vi.mock('$lib/server/rateLimit', () => ({ isRateLimited: () => false }));

const { confirmWorkshopSjkReceipt, tokensMatch } = await import('./workshopSjkReceipt');
const { parseEpiQr } = await import('$lib/utils/qrParse');

const ev = (body: any): any => ({ request: new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }) });
type Call = { path: string; method: string; body: any };
let calls: Call[] = [];

const SJK = { id: 7, no_sj: 'SJK-1', project: 3, diterima_at: null, qr_token: 'tok-abc', approval_status: 'approved', security_verified_at: '2026-10-16T01:00:00Z', status_kirim: 'proses' };
let sjkRow: any;
let behaviour: { readFails?: boolean; scanLogFails?: boolean; patchRows?: Array<{ id: number }> | 'throw'; groupIds?: number[] };

function wire() {
	h.directus.mockImplementation(async (path: string, opts: any = {}) => {
		const call: Call = { path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null };
		calls.push(call);
		if (path.includes('_surat_jalan_keluar?filter[id][_eq]=')) { if (behaviour.readFails) throw new Error('500'); return { data: sjkRow ? [sjkRow] : [] }; }
		if (path.includes('filter[no_sj][_eq]=')) return { data: (behaviour.groupIds || [7]).map((id) => ({ id })) };
		if (path.startsWith('/items/category')) return { data: [{ id: 'cat-1' }] };
		if (path === '/items/scan_log' && call.method === 'POST') { if (behaviour.scanLogFails) throw new Error('log down'); return { data: { id: 900 } }; }
		if (path.startsWith('/items/scan_log/') && call.method === 'DELETE') return {};
		if (call.method === 'PATCH') {
			if (behaviour.patchRows === 'throw') throw new Error('patch down');
			return { data: behaviour.patchRows ?? (behaviour.groupIds || [7]).map((id) => ({ id })) };
		}
		return { data: {} };
	});
}
const status = (p: Promise<any>) => p.then(() => 200, (e) => e?.status ?? 500);
const run = (body: any, ws: any = 'ciketing') => confirmWorkshopSjkReceipt(ev({ sjkId: 7, token: 'tok-abc', receiverName: 'Pak Andi', ...body }), ws);
const writes = () => calls.filter((c) => c.method === 'PATCH' || (c.method === 'POST' && c.path === '/items/scan_log'));

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	calls = [];
	sjkRow = { ...SJK };
	behaviour = {};
	h.modes = {};
	wire();
});

describe('parseEpiQr BLJ-SJK-V2', () => {
	it('dikenali sebagai tipe berparameter; BLJ-SJK lama tetap valid & berbeda', () => {
		expect(parseEpiQr('EPI:BLJ-SJK-V2:12:abc')).toEqual({ type: 'BLJ-SJK-V2', id: 12, token: 'abc' });
		expect(parseEpiQr('EPI:BLJ-SJK:12:abc')).toEqual({ type: 'BLJ-SJK', id: 12, token: 'abc' });
		expect(parseEpiQr('EPI:CIK-SJK-V2:3:t')).toEqual({ type: 'CIK-SJK-V2', id: 3, token: 't' });
		expect(parseEpiQr('EPI:BLJ-SJK-V2:12')).toBeNull();
		expect(parseEpiQr('EPI:BLJ-SJK-V2:0:t')).toBeNull();
	});
	it('URL /scan/<payload> (QR cetak) juga terbaca', () => {
		expect(parseEpiQr('https://project.eltamaprimaindo.com/scan/' + encodeURIComponent('EPI:BLJ-SJK-V2:5:tok'))).toMatchObject({ type: 'BLJ-SJK-V2', id: 5 });
	});
});

describe('tokensMatch', () => {
	it('cocok persis saja; kosong / beda panjang / beda isi → false (tanpa melempar)', () => {
		expect(tokensMatch('abc', 'abc')).toBe(true);
		expect(tokensMatch('abc', 'abd')).toBe(false);
		expect(tokensMatch('abc', 'abcd')).toBe(false);
		expect(tokensMatch(null, 'abc')).toBe(false);
		expect(tokensMatch('abc', '')).toBe(false);
	});
});

describe('confirmWorkshopSjkReceipt — token (anti-IDOR)', () => {
	it('tanpa token → 400; token salah → 403; keduanya TIDAK menulis apa pun', async () => {
		expect(await status(confirmWorkshopSjkReceipt(ev({ sjkId: 7, receiverName: 'X' }), 'ciketing'))).toBe(400);
		expect(await status(run({ token: 'salah' }))).toBe(403);
		expect(writes()).toHaveLength(0);
	});
	it('token SJ lain dipakai untuk id ini → 403', async () => {
		sjkRow = { ...SJK, qr_token: 'token-milik-sjk-7' };
		expect(await status(run({ token: 'token-milik-sjk-8' }))).toBe(403);
		expect(writes()).toHaveLength(0);
	});
	it('SJ tidak ada → 404; galat Directus saat baca → 502 (BUKAN 404 palsu); input tidak valid → 400; workshop tak dikenal → 400', async () => {
		sjkRow = null;
		expect(await status(run({}))).toBe(404);
		sjkRow = { ...SJK }; behaviour.readFails = true;
		expect(await status(run({}))).toBe(502);
		behaviour.readFails = false;
		expect(await status(run({ sjkId: 'x' }))).toBe(400);
		expect(await status(run({ receiverName: '  ' }))).toBe(400);
		expect(await status(run({}, 'xyz'))).toBe(400);
	});
	it('sudah diterima → 409, tidak ada penulisan', async () => {
		sjkRow = { ...SJK, diterima_at: '2026-10-01T00:00:00Z' };
		expect(await status(run({}))).toBe(409);
		expect(writes()).toHaveLength(0);
	});
});

describe('confirmWorkshopSjkReceipt — penulisan', () => {
	it('Ciketing: SEMUA baris no_sj+project dikonfirmasi, status_kirim → terkirim, PATCH bersyarat bentuk { query, data }', async () => {
		behaviour.groupIds = [7, 8, 9];
		const r = await run({ fotoFileId: 'f-1' });
		const out = await r.json();
		expect(out).toMatchObject({ success: true, noSj: 'SJK-1', baris: 3 });
		const grp = calls.find((c) => c.path.includes('filter[no_sj]'))!;
		expect(grp.path).toContain('/items/ciketing_surat_jalan_keluar?');
		expect(grp.path).toContain('filter[project][_eq]=3');
		expect(grp.path).toContain('filter[diterima_at][_null]=true');
		const patches = calls.filter((c) => c.method === 'PATCH');
		expect(patches).toHaveLength(1);
		expect(patches[0].path).toBe('/items/ciketing_surat_jalan_keluar');
		expect(patches[0].body.query.filter._and).toEqual([{ id: { _in: [7, 8, 9] } }, { diterima_at: { _null: true } }]);
		expect(patches[0].body.data).toMatchObject({ diterima_oleh: 'Pak Andi', status_kirim: 'terkirim', diterima_foto: 'f-1' });
		expect(patches[0].body.data.diterima_at).toBeTruthy();
	});
	it('Balaraja memakai koleksi & gate satpam Balaraja', async () => {
		sjkRow = { ...SJK, security_verified_at: null };
		h.modes = { G_BL_SJ_SECURITY: 'hard' };
		expect(await status(run({}, 'balaraja'))).toBe(403);
		expect(calls.find((c) => c.path.includes('balaraja_surat_jalan_keluar?filter[id]'))).toBeTruthy();
		h.modes = { G_BL_SJ_SECURITY: 'shadow' };
		calls = [];
		const r = await run({}, 'balaraja');
		expect((await r.json()).success).toBe(true);
		expect(calls.find((c) => c.method === 'PATCH')!.path).toBe('/items/balaraja_surat_jalan_keluar');
	});
	it('scan_log ditulis SEBELUM PATCH, dengan actor_id karyawan; activity_log modul workshop / sjk_diterima dengan before-after', async () => {
		await run({});
		const idxLog = calls.findIndex((c) => c.path === '/items/scan_log' && c.method === 'POST');
		const idxPatch = calls.findIndex((c) => c.method === 'PATCH');
		expect(idxLog).toBeGreaterThan(-1);
		expect(idxLog).toBeLessThan(idxPatch);
		expect(calls[idxLog].body).toMatchObject({ ref_collection: 'ciketing_surat_jalan_keluar', ref_id: '7', actor_id: 42, source: 'lapangan' });
		const act = calls.find((c) => c.path === '/items/activity_log')!;
		expect(act.body).toMatchObject({ module: 'workshop', action: 'sjk_diterima', record_id: '7' });
		expect(act.body.changes.before.diterima_at).toBeNull();
		expect(act.body.changes.after.status_kirim).toBe('terkirim');
	});
	it('scan_log gagal → konfirmasi DIBATALKAN (502), PATCH tidak dijalankan', async () => {
		behaviour.scanLogFails = true;
		expect(await status(run({}))).toBe(502);
		expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
	});
	it('balapan: PATCH bersyarat 0 baris → 409 dan scan_log dikompensasi (dihapus)', async () => {
		behaviour.patchRows = [];
		expect(await status(run({}))).toBe(409);
		expect(calls.some((c) => c.method === 'DELETE' && c.path === '/items/scan_log/900')).toBe(true);
	});
	it('PATCH gagal → 502 + scan_log dikompensasi', async () => {
		behaviour.patchRows = 'throw';
		expect(await status(run({}))).toBe(502);
		expect(calls.some((c) => c.method === 'DELETE' && c.path === '/items/scan_log/900')).toBe(true);
	});
});

describe('confirmWorkshopSjkReceipt — gate approval Finance (G_WS_TERIMA_BELUM_APPROVE)', () => {
	beforeEach(() => { sjkRow = { ...SJK, approval_status: 'menunggu' }; });
	it('mode hard → 403, tidak menulis', async () => {
		h.modes = { G_WS_TERIMA_BELUM_APPROVE: 'hard' };
		expect(await status(run({}))).toBe(403);
		expect(writes()).toHaveLength(0);
	});
	it('mode soft tanpa alasan → 422 GATE_REASON_REQUIRED; alasan pendek juga; tidak menulis', async () => {
		h.modes = { G_WS_TERIMA_BELUM_APPROVE: 'soft' };
		const r = await run({});
		expect(r.status).toBe(422);
		const out = await r.json();
		expect(out).toMatchObject({ success: false, code: 'GATE_REASON_REQUIRED', minAlasan: 20 });
		expect(out.gates[0].gate_key).toBe('G_WS_TERIMA_BELUM_APPROVE');
		expect((await run({ exceptionReason: 'terlalu pendek' })).status).toBe(422);
		expect(writes()).toHaveLength(0);
	});
	it('mode soft dengan alasan ≥ 20 karakter → lolos dan alasan tercatat di scan_log.notes', async () => {
		h.modes = { G_WS_TERIMA_BELUM_APPROVE: 'soft' };
		const r = await run({ exceptionReason: 'Barang sudah dicek bersama sopir, Finance menyusul' });
		expect((await r.json()).success).toBe(true);
		expect(calls.find((c) => c.path === '/items/scan_log')!.body.notes).toContain('Pengecualian G_WS_TERIMA_BELUM_APPROVE: Barang sudah dicek');
	});
	it('gate belum terdaftar (fallback soft) memakai jalur yang sama; mode shadow/warn → lolos tanpa alasan', async () => {
		h.modes = { G_WS_TERIMA_BELUM_APPROVE: 'shadow' };
		expect((await (await run({})).json()).success).toBe(true);
	});
	it('satpam & Finance sama-sama belum → kedua gate dilaporkan dalam satu 422', async () => {
		sjkRow = { ...SJK, approval_status: 'menunggu', security_verified_at: null };
		h.modes = { G_WS_TERIMA_BELUM_APPROVE: 'soft', G_CIK_SJ_SECURITY: 'soft' };
		const out = await (await run({})).json();
		expect(out.gates.map((g: any) => g.gate_key)).toEqual(['G_WS_TERIMA_BELUM_APPROVE', 'G_CIK_SJ_SECURITY']);
	});
});
