// WSK-35 4b — gerbang satpam SJ Keluar workshop.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ directus: vi.fn() }));
vi.mock('../directus', () => ({ directusServerJson: (...a: any[]) => h.directus(...a) }));

import { approvalOfGroup, buildDetail, cariWorkshop, loloskanWorkshop, tahanWorkshop } from './workshop';
import { resetSelfVerifyCache } from './selfVerify';
import { GateError, type GateActor } from './types';

const actor: GateActor = { sumber: 'app', karyawanId: 7, nama: 'Budi', email: null, label: 'APP/Budi' };
const row = (o: any = {}) => ({
	id: 1, no_sj: 'SJ-1', tanggal: '2026-10-16', tujuan: 'PT A', project: 3, nama_barang: 'Pipa', qty: 2, satuan: 'Pcs',
	approval_status: 'approved', pracetak_gudang: { by_name: 'Gudang', at: 'x' }, security_verified_at: null, qr_token: 'tok', ...o
});

function mockDb(rows: any[], extra: (path: string, init?: any) => any = () => undefined) {
	h.directus.mockImplementation(async (path: string, init?: any) => {
		const x = extra(path, init);
		if (x !== undefined) return x;
		// default realistis: kolom pembuat BELUM ada di Directus (403) & setelan kunci kosong
		if (path.startsWith('/fields/')) { const e: any = new Error('403'); e.status = 403; throw e; }
		if (path.startsWith('/items/app_settings')) return { data: [] };
		if (path.includes('/scan_log?filter[client_event_id]')) return { data: [] };
		if (path.includes('/items/projects/')) return { data: { name: 'Proyek A' } };
		if (/\/items\/[a-z_]+\/\d+\?fields=/.test(path)) return { data: rows.find((r) => path.includes(`/${r.id}?`)) || rows[0] };
		if (path.includes('?filter[no_sj][_eq]=')) return { data: rows };
		if (path.includes('/items/scan_log?filter[ref_collection]')) return { data: [] };
		return { data: {} };
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	resetSelfVerifyCache();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('workshop gate — murni', () => {
	it('approvalOfGroup: semua approved / ada rejected / campur', () => {
		expect(approvalOfGroup([row(), row({ id: 2 })])).toBe('approved');
		expect(approvalOfGroup([row(), row({ id: 2, approval_status: 'rejected' })])).toBe('rejected');
		expect(approvalOfGroup([row(), row({ id: 2, approval_status: 'menunggu' })])).toBe('menunggu');
	});

	it('buildDetail: belum disetujui → blocker; belum siap gudang → hanya warning', () => {
		const d = buildDetail('ciketing', [row({ approval_status: 'menunggu', pracetak_gudang: null })], 'P', null);
		expect(d.can_pass).toBe(false);
		expect(d.blockers.map((b) => b.kode)).toEqual(['BELUM_DISETUJUI']);
		expect(d.warnings.map((w) => w.kode)).toEqual(['BELUM_SIAP_GERBANG']);
		const ok = buildDetail('balaraja', [row({ pracetak_gudang: null })], 'P', null);
		expect(ok.can_pass).toBe(true);
	});

	it('buildDetail: sudah lolos → SUDAH_LOLOS, tidak ada penahanan', () => {
		const d = buildDetail('ciketing', [row({ security_verified_at: 't', security_verified_by: 'X' })], null, { alasan: 'a', oleh: null, waktu: null });
		expect(d.sudah_lolos).toBe(true);
		expect(d.ditahan).toBeNull();
		expect(d.blockers[0].kode).toBe('SUDAH_LOLOS');
	});
});

describe('loloskanWorkshop', () => {
	it('SJ belum disetujui Finance → ditolak, tidak menulis', async () => {
		mockDb([row({ approval_status: 'menunggu' })]);
		await expect(loloskanWorkshop(actor, 'ciketing', 1, { client_event_id: 'evt-12345678', jumlah_ok: true })).rejects.toMatchObject({ kode: 'BELUM_DISETUJUI' });
		expect(h.directus.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(false);
	});

	it('jumlah belum dikonfirmasi → CEK_BELUM_LENGKAP', async () => {
		mockDb([row()]);
		await expect(loloskanWorkshop(actor, 'balaraja', 1, { client_event_id: 'evt-12345678', jumlah_ok: false })).rejects.toMatchObject({ kode: 'CEK_BELUM_LENGKAP' });
	});

	it('sukses: satu PATCH {keys,data} ke semua baris grup + scan_log', async () => {
		mockDb([row({ id: 1 }), row({ id: 2 })]);
		const r = await loloskanWorkshop(actor, 'balaraja', 1, { client_event_id: 'evt-12345678', jumlah_ok: true, catatan: 'ok' });
		expect(r).toMatchObject({ ok: true, hasil: 'lolos', idempoten: false });
		const patch = h.directus.mock.calls.find((c) => c[1]?.method === 'PATCH')!;
		expect(patch[0]).toBe('/items/balaraja_surat_jalan_keluar');
		const body = JSON.parse(patch[1].body);
		expect(body.keys).toEqual([1, 2]);
		expect(body.data.security_verified_by).toBe('APP/Budi');
		const log = h.directus.mock.calls.find((c) => c[0] === '/items/scan_log' && c[1]?.method === 'POST')!;
		expect(JSON.parse(log[1].body)).toMatchObject({ ref_collection: 'balaraja_surat_jalan_keluar', actor_id: 7, client_event_id: 'evt-12345678' });
	});

	it('idempoten: client_event_id sama → tidak menulis lagi', async () => {
		mockDb([row()], (p) => (p.includes('/scan_log?filter[client_event_id]') ? { data: [{ id: 1 }] } : undefined));
		const r = await loloskanWorkshop(actor, 'ciketing', 1, { client_event_id: 'evt-12345678', jumlah_ok: true });
		expect(r.idempoten).toBe(true);
		expect(h.directus.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(false);
	});

	it('gagal PATCH → GateError 503 (tidak ada sukses palsu)', async () => {
		mockDb([row()], (_p, init) => {
			if (init?.method === 'PATCH') throw new Error('x');
			return undefined;
		});
		await expect(loloskanWorkshop(actor, 'ciketing', 1, { client_event_id: 'evt-12345678', jumlah_ok: true })).rejects.toMatchObject({ status: 503 });
	});

	it('client_event_id wajib', async () => {
		mockDb([row()]);
		await expect(loloskanWorkshop(actor, 'ciketing', 1, { jumlah_ok: true })).rejects.toBeInstanceOf(GateError);
	});
});

describe('tahanWorkshop', () => {
	it('alasan wajib', async () => {
		mockDb([row()]);
		await expect(tahanWorkshop(actor, 'ciketing', 1, { client_event_id: 'evt-12345678', alasan: 'x' })).rejects.toMatchObject({ kode: 'ALASAN_WAJIB' });
	});

	it('tahan: hanya scan_log + notifikasi, TIDAK mengubah data SJ', async () => {
		mockDb([row()]);
		const r = await tahanWorkshop(actor, 'ciketing', 1, { client_event_id: 'evt-12345678', alasan: 'Jumlah kurang 2' });
		expect(r.hasil).toBe('ditahan');
		expect(h.directus.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(false);
		const log = h.directus.mock.calls.find((c) => c[0] === '/items/scan_log' && c[1]?.method === 'POST')!;
		expect(JSON.parse(log[1].body).notes).toMatch(/^TAHAN \[gerbang\] Jumlah kurang 2/);
	});

	it('SJ yang sudah lolos tidak bisa ditahan', async () => {
		mockDb([row({ security_verified_at: 't' })]);
		await expect(tahanWorkshop(actor, 'ciketing', 1, { client_event_id: 'evt-12345678', alasan: 'alasan cukup' })).rejects.toMatchObject({ kode: 'TIDAK_BISA_DITAHAN' });
	});
});

describe('cariWorkshop', () => {
	const tokenRow = (p: string) => (p.includes('?fields=id,qr_token') ? { data: { id: 1, qr_token: 'tok' } } : undefined);

	it('QR dengan token salah → QR_TIDAK_COCOK', async () => {
		mockDb([row()], tokenRow);
		await expect(cariWorkshop({ code: 'EPI:CIK-SJK-V2:1:salah' })).rejects.toMatchObject({ kode: 'QR_TIDAK_COCOK' });
	});

	it('QR benar → detail dengan nama proyek', async () => {
		mockDb([row()], tokenRow);
		const d = await cariWorkshop({ code: 'EPI:BLJ-SJK-V2:1:tok' });
		expect(d).toMatchObject({ workshop: 'balaraja', no_sj: 'SJ-1', project_nama: 'Proyek A' });
	});

	it('bukan QR workshop → INPUT_TIDAK_VALID', async () => {
		await expect(cariWorkshop({ code: 'EPI:SJ:1:abc' })).rejects.toMatchObject({ kode: 'INPUT_TIDAK_VALID' });
	});
});

describe('loloskanWorkshop — kunci pembuat SJ ≠ satpam (WSK-35 §4a)', () => {
	const evt = 'evt-12345678';
	const lock = (opts: { ready?: boolean; creators?: number[]; mode?: string } = {}) => {
		const { ready = true, creators = [7, 7], mode } = opts;
		mockDb([row()], (path, init) => {
			if (path.startsWith('/fields/')) { if (!ready) { const e: any = new Error('403'); e.status = 403; throw e; } return { data: {} }; }
			if (path.startsWith('/items/app_settings')) return { data: mode ? [{ setting_value: mode }] : [] };
			if (path.includes('fields=id,dibuat_oleh_karyawan_id')) return { data: creators.map((c, i) => ({ id: i + 1, dibuat_oleh_karyawan_id: c })) };
			if (path.startsWith('/items/karyawan/')) return { data: { atasan_id: 21 } };
			void init;
			return undefined;
		});
	};
	const patched = () => h.directus.mock.calls.some((c) => c[1]?.method === 'PATCH');
	const notif = () => h.directus.mock.calls.filter((c) => c[0] === '/items/app_notifications').map((c) => JSON.parse(c[1].body));

	it('kolom BELUM ada → kunci tidak aktif; tidak ada query ke kolom itu', async () => {
		lock({ ready: false });
		const r = await loloskanWorkshop(actor, 'ciketing', 1, { client_event_id: evt, jumlah_ok: true });
		expect(r.hasil).toBe('lolos');
		expect(h.directus.mock.calls.some((c) => !String(c[0]).startsWith('/fields/') && String(c[0]).includes('dibuat_oleh_karyawan_id'))).toBe(false);
	});

	it('pembuat = satpam tanpa alasan → 409 VERIFIKASI_SENDIRI_ALASAN_WAJIB, tidak menulis', async () => {
		lock({ creators: [7, 7] });
		await expect(loloskanWorkshop(actor, 'ciketing', 1, { client_event_id: evt, jumlah_ok: true })).rejects.toMatchObject({ status: 409, kode: 'VERIFIKASI_SENDIRI_ALASAN_WAJIB' });
		expect(patched()).toBe(false);
	});

	it('pembuat = satpam dengan alasan di catatan/alasan_diri → lolos + atasan diberi tahu', async () => {
		lock({ creators: [7] });
		const r = await loloskanWorkshop(actor, 'ciketing', 1, { client_event_id: evt, jumlah_ok: true, alasan_diri: 'Hanya saya satpam yang bertugas malam ini' });
		expect(r.hasil).toBe('lolos');
		expect(patched()).toBe(true);
		const n = notif();
		expect(n).toHaveLength(1);
		expect(n[0]).toMatchObject({ type: 'sjk_verifikasi_sendiri', karyawan_id: 21, priority: 'high' });
	});

	it('bukan pembuat / SJ lama (kosong) → lolos tanpa notifikasi', async () => {
		lock({ creators: [3] });
		await loloskanWorkshop(actor, 'ciketing', 1, { client_event_id: evt, jumlah_ok: true });
		lock({ creators: [] });
		await loloskanWorkshop(actor, 'balaraja', 1, { client_event_id: 'evt-87654321', jumlah_ok: true });
		expect(notif()).toHaveLength(0);
	});

	it('mode block menolak walau ada alasan; mode off mematikan', async () => {
		lock({ creators: [7], mode: 'block' });
		await expect(loloskanWorkshop(actor, 'ciketing', 1, { client_event_id: evt, jumlah_ok: true, alasan_diri: 'alasan yang sangat panjang' })).rejects.toMatchObject({ kode: 'VERIFIKASI_SENDIRI_DIBLOKIR' });
		resetSelfVerifyCache();
		lock({ creators: [7], mode: 'off' });
		await expect(loloskanWorkshop(actor, 'ciketing', 1, { client_event_id: 'evt-11112222', jumlah_ok: true })).resolves.toMatchObject({ hasil: 'lolos' });
	});

	it('gagal membaca pembuat → 503 (kunci tidak dilewati diam-diam)', async () => {
		mockDb([row()], (path) => {
			if (path.startsWith('/fields/')) return { data: {} };
			if (path.startsWith('/items/app_settings')) return { data: [] };
			if (path.includes('fields=id,dibuat_oleh_karyawan_id')) throw new Error('boom');
			return undefined;
		});
		await expect(loloskanWorkshop(actor, 'ciketing', 1, { client_event_id: evt, jumlah_ok: true })).rejects.toMatchObject({ status: 503 });
		expect(patched()).toBe(false);
	});
});
