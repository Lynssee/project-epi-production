import { describe, it, expect } from 'vitest';
import { evaluatePass, validateLoloskan, validateTahan, assertBisaDitahan, resolveKoliAcuan } from './rules';
import { normalizeChecklist, buildRiwayat } from './checklist';
import { GateError } from './types';

const ok = { jumlah_ok: true, plat_ok: true, driver_ok: true };
const ctx = { koli_acuan: 3, item_ids: [1, 2], item_wajib: true };
const code = (fn: () => unknown) => {
	try { fn(); return null; } catch (e) { return e instanceof GateError ? e.kode : 'LAIN'; }
};

describe('evaluatePass (GSP-04 §6)', () => {
	it('1 shipped → SUDAH_LOLOS', () => {
		const r = evaluatePass({ status: 'shipped' });
		expect(r).toMatchObject({ already_passed: true, can_pass: false });
		expect(r.blockers[0].kode).toBe('SUDAH_LOLOS');
	});
	it('2 needs_security_check + security_verified_at (backfill) → DATA_TIDAK_KONSISTEN', () => {
		const r = evaluatePass({ status: 'needs_security_check', security_verified_at: '2026-09-09' });
		expect(r.can_pass).toBe(false);
		expect(r.blockers.map((b) => b.kode)).toContain('DATA_TIDAK_KONSISTEN');
	});
	it('3 approval menunggu → BELUM_DISETUJUI', () => {
		const r = evaluatePass({ status: 'needs_security_check', approval_status: 'menunggu', koli_acuan: 1 });
		expect(r.blockers.map((b) => b.kode)).toEqual(['BELUM_DISETUJUI']);
	});
	it('status lain → BELUM_SIAP_GERBANG; ditolak → DITOLAK_APPROVER', () => {
		expect(evaluatePass({ status: 'draft' }).blockers[0].kode).toBe('BELUM_SIAP_GERBANG');
		expect(evaluatePass({ status: 'needs_security_check', approval_status: 'ditolak' }).blockers.map((b) => b.kode)).toContain('DITOLAK_APPROVER');
	});
	it('siap → can_pass; koli null → warning', () => {
		const r = evaluatePass({ status: 'needs_security_check', approval_status: 'disetujui', koli_acuan: null });
		expect(r.can_pass).toBe(true);
		expect(r.warnings.map((w) => w.kode)).toContain('KOLI_TIDAK_TERCATAT');
	});
	it('pernah ditahan bukan blocker', () => {
		const r = evaluatePass({ status: 'needs_security_check', security_checklist: { versi: 2, hasil: 'ditahan' }, koli_acuan: 2 });
		expect(r).toMatchObject({ can_pass: true, ditahan: true });
		expect(r.warnings.map((w) => w.kode)).toContain('PERNAH_DITAHAN');
	});
	it('blocker ekstra (guard SJH-12) digabung tanpa dobel', () => {
		const r = evaluatePass(
			{ status: 'needs_security_check', approval_status: 'menunggu' },
			{ blockers: [{ kode: 'BELUM_DISETUJUI', pesan: 'x', siapa: null }, { kode: 'BELUM_DICETAK', pesan: 'y', siapa: null }] }
		);
		expect(r.blockers.map((b) => b.kode)).toEqual(['BELUM_DISETUJUI', 'BELUM_DICETAK']);
	});
});

describe('validateLoloskan', () => {
	const base = { client_event_id: 'gerbang-12345678', checklist: ok, koli_dihitung: 3, items: [{ sj_item_id: 1, ok: true }, { sj_item_id: 2, ok: true }] };
	it('valid', () => expect(validateLoloskan(base, ctx).koli_dihitung).toBe(3));
	it('client_event_id kosong → CLIENT_EVENT_ID_WAJIB', () =>
		expect(code(() => validateLoloskan({ ...base, client_event_id: '' }, ctx))).toBe('CLIENT_EVENT_ID_WAJIB'));
	it('plat_ok=false → CEK_BELUM_LENGKAP (4)', () =>
		expect(code(() => validateLoloskan({ ...base, checklist: { ...ok, plat_ok: false } }, ctx))).toBe('CEK_BELUM_LENGKAP'));
	it('1 item ok=false → ADA_SELISIH_ITEM (5)', () =>
		expect(code(() => validateLoloskan({ ...base, items: [{ sj_item_id: 1, ok: true }, { sj_item_id: 2, ok: false }] }, ctx))).toBe('ADA_SELISIH_ITEM'));
	it('item kurang / asing → ITEM_BELUM_DICEK', () => {
		expect(code(() => validateLoloskan({ ...base, items: [{ sj_item_id: 1, ok: true }] }, ctx))).toBe('ITEM_BELUM_DICEK');
		expect(code(() => validateLoloskan({ ...base, items: [{ sj_item_id: 1, ok: true }, { sj_item_id: 9, ok: true }] }, ctx))).toBe('ITEM_BELUM_DICEK');
	});
	it('koli beda / wajib dihitung', () => {
		expect(code(() => validateLoloskan({ ...base, koli_dihitung: 2 }, ctx))).toBe('KOLI_BEDA');
		expect(code(() => validateLoloskan({ ...base, koli_dihitung: null }, { ...ctx, koli_acuan: null }))).toBe('KOLI_WAJIB_DIHITUNG');
	});
	it('item tidak wajib (K1=B): items boleh kosong', () => {
		expect(validateLoloskan({ ...base, items: undefined }, { ...ctx, item_wajib: false }).items).toBeNull();
	});
	it('legacy melonggarkan items & koli', () => {
		expect(code(() => validateLoloskan({ client_event_id: 'gerbang-12345678', checklist: ok }, { ...ctx, koli_acuan: null, legacy: true }))).toBeNull();
	});
});

describe('validateTahan / assertBisaDitahan', () => {
	it('alasan pendek → ALASAN_WAJIB (8)', () =>
		expect(code(() => validateTahan({ client_event_id: 'gerbang-12345678', alasan: 'ok', kategori: 'plat' }))).toBe('ALASAN_WAJIB'));
	it('kategori asing', () =>
		expect(code(() => validateTahan({ client_event_id: 'gerbang-12345678', alasan: 'plat beda', kategori: 'xx' }))).toBe('KATEGORI_TIDAK_DIKENAL'));
	it('valid', () =>
		expect(validateTahan({ client_event_id: 'gerbang-12345678', alasan: 'Plat beda', kategori: 'plat' }).kategori).toBe('plat'));
	it('shipped → TIDAK_BISA_DITAHAN (9)', () => {
		expect(code(() => assertBisaDitahan('shipped'))).toBe('TIDAK_BISA_DITAHAN');
		expect(code(() => assertBisaDitahan('needs_security_check'))).toBeNull();
	});
});

describe('resolveKoliAcuan', () => {
	it('fleet → item → null', () => {
		expect(resolveKoliAcuan(5, [])).toEqual({ koli_acuan: 5, koli_sumber: 'fleet' });
		expect(resolveKoliAcuan(null, [{ jumlah_pcs: 2 }, { jumlah_pcs: 1 }])).toEqual({ koli_acuan: 3, koli_sumber: 'item' });
		expect(resolveKoliAcuan(null, [{ jumlah_pcs: 2 }, { jumlah_pcs: null }])).toEqual({ koli_acuan: null, koli_sumber: null });
	});
});

describe('normalizeChecklist (GSP-07)', () => {
	it('teks, null, angka, array', () => {
		expect(normalizeChecklist(null)).toBeNull();
		expect(normalizeChecklist('Diloloskan massal')).toMatchObject({ hasil: 'tidak_diketahui', catatan: 'Diloloskan massal', riwayat: [] });
		expect(normalizeChecklist(42)).toMatchObject({ hasil: 'tidak_diketahui', catatan: '42' });
		expect(normalizeChecklist([1])).toMatchObject({ hasil: 'tidak_diketahui' });
	});
	it('v1 kiosk lolos / tahan / ERP tolak', () => {
		expect(normalizeChecklist({ jumlah_ok: true, plat_ok: true, driver_ok: true, oleh_kiosk: 'BUDI' })).toMatchObject({ hasil: 'lolos', oleh_nama: 'BUDI' });
		expect(normalizeChecklist({ ditahan: true, alasan: 'plat', oleh: 'KIOSK/X' })).toMatchObject({ hasil: 'ditahan', alasan: 'plat', oleh_nama: 'KIOSK/X' });
		expect(normalizeChecklist({ ditolak: true, catatan: 'rusak' })).toMatchObject({ hasil: 'ditahan', alasan: 'rusak' });
	});
	it('v2 dikembalikan; teks tidak jadi objek per huruf', () => {
		expect(normalizeChecklist({ versi: 2, hasil: 'lolos' })!.hasil).toBe('lolos');
		expect(Object.keys({ ...normalizeChecklist('Dilol') })).not.toContain('0');
	});
	it('riwayat: hasil sebelumnya disalin, maks 10', () => {
		const prev = normalizeChecklist({ versi: 2, hasil: 'ditahan', kategori: 'plat', alasan: 'a', riwayat: Array.from({ length: 12 }, () => ({ hasil: 'ditahan' })) })!;
		const r = buildRiwayat(prev);
		expect(r).toHaveLength(10);
		expect(r[0]).toMatchObject({ hasil: 'ditahan', kategori: 'plat' });
		expect(buildRiwayat(normalizeChecklist('teks'))).toEqual([]);
	});
});
