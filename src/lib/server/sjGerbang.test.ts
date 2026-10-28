import { describe, it, expect, vi, beforeEach } from 'vitest';

const directus = vi.fn();
const track = vi.fn().mockResolvedValue({ ok: true });
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: unknown[]) => directus(...a) }));
vi.mock('$env/dynamic/private', () => ({ env: {} })); // erp-epi tidak terkonfigurasi -> gate_check 'tidak_terhubung', gerbang tidak dikunci
vi.mock('$lib/server/sjTracking', () => ({ recordKioskTrackingEvent: (...a: unknown[]) => track(...a) }));

import { passSjAtGate } from './sjGerbang';
import { assertBatchPatch } from './directusCasTestkit';

const base = {
	sjId: 5, actor: { id: 1, nama: 'Satpam' }, verifiedBy: 'KIOSK/Satpam',
	checklist: { jumlah_ok: true, plat_ok: true, driver_ok: true }, clientEventId: 'e1', source: 'kiosk' as const
};
const sj = (o: Record<string, unknown> = {}) => ({ data: { id: 5, nomor_sj: 'SJ/1', status: 'needs_security_check', print_count: 1, approval_status: null, security_verified_at: null, ...o } });

beforeEach(() => { directus.mockReset(); track.mockClear(); });

describe('passSjAtGate (SJH-14)', () => {
	it('checklist tidak lengkap → 400', async () => {
		await expect(passSjAtGate({ ...base, checklist: { jumlah_ok: true, plat_ok: false, driver_ok: true } })).rejects.toMatchObject({ status: 400 });
	});
	it('belum dicetak → 409, tidak ada PATCH', async () => {
		directus.mockResolvedValueOnce(sj({ print_count: 0 })).mockResolvedValue({ data: [] });
		await expect(passSjAtGate(base)).rejects.toMatchObject({ status: 409 });
		expect(directus.mock.calls.some((c: any[]) => c[1]?.method === 'PATCH')).toBe(false);
	});
	it('sudah lolos → already_passed, tanpa PATCH', async () => {
		directus.mockResolvedValueOnce(sj({ status: 'shipped' }));
		expect(await passSjAtGate(base)).toEqual({ already_passed: true });
		expect(directus.mock.calls.some((c: any[]) => c[1]?.method === 'PATCH')).toBe(false);
	});
	it('CAS kosong (kalah balapan) → already_passed', async () => {
		directus.mockResolvedValueOnce(sj()).mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
		expect(await passSjAtGate(base)).toEqual({ already_passed: true });
	});
	it('sukses → shipped + draft_status siap_kirim + event lolos_gerbang', async () => {
		directus.mockResolvedValueOnce(sj()).mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [{ id: 5 }] });
		expect(await passSjAtGate(base)).toEqual({ already_passed: false, newStatus: 'shipped' });
		const patch = directus.mock.calls.find((c: any[]) => c[1]?.method === 'PATCH');
		// bentuk wajib Directus prod: PATCH /items/surat_jalan + { query:{filter}, data } (filter di URL + body polos = 400)
		expect(patch![0]).toBe('/items/surat_jalan');
		const { filter, data } = assertBatchPatch(patch![0], patch![1].body);
		expect((filter as any)._and).toEqual([{ id: { _eq: 5 } }, { status: { _eq: 'needs_security_check' } }]);
		expect(data).toMatchObject({ status: 'shipped', draft_status: 'siap_kirim', security_verified_by: 'KIOSK/Satpam' });
		expect(data.security_checklist.gate_check).toBe('tidak_terhubung');
		expect(track).toHaveBeenCalledWith(expect.objectContaining({ stageTo: 'lolos_gerbang' }));
	});
});
