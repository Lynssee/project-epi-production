// Cron auto-close site check-in: otorisasi, batas "sebelum hari ini WIB", penutupan per baris, dan penyebab gagal ikut dilaporkan.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { AUTOMATION_SERVER_SECRET: 'rahasia' } }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));
vi.mock('$lib/server/siteCheckin', () => ({ closeCheckin: vi.fn() }));
vi.mock('$lib/server/ess/time', () => ({ todayJakarta: (d?: Date) => (d ? d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }) : '2026-10-29') }));

import { directusServerJson } from '$lib/server/directus';
import { closeCheckin } from '$lib/server/siteCheckin';
import { POST } from './+server';

const dx = vi.mocked(directusServerJson);
const tutup = vi.mocked(closeCheckin);
const panggil = (body: any): Promise<any> => (POST as any)({ request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) });

beforeEach(() => {
	dx.mockReset(); tutup.mockReset();
	dx.mockResolvedValue({ data: [{ id: 'a', karyawan_id: '135', check_in_at: '2026-10-04T07:08:58.651Z' }, { id: 'b', karyawan_id: '9', check_in_at: '2026-10-28T02:00:00.000Z' }] });
	tutup.mockResolvedValue({} as any);
});

describe('POST /api/site-checkin/auto-close', () => {
	it('secret salah → 401 dan tidak membaca data; secret server kosong → 503 (tes lain)', async () => {
		await expect(panggil({ secret: 'salah' })).rejects.toMatchObject({ status: 401 });
		expect(dx).not.toHaveBeenCalled();
	});

	it('mencari yang aktif sebelum 00:00 WIB hari ini (= 17:00 UTC kemarin) dan menutup tiap baris di akhir hari WIB check-in-nya', async () => {
		const j = await (await panggil({ secret: 'rahasia' })).json();
		expect(decodeURIComponent(String(dx.mock.calls[0][0]))).toContain('filter[check_in_at][_lt]=2026-10-28T17:00:00.000Z');
		expect(j).toMatchObject({ checked: 2, closed: 2, failed: 0, gagal: [] });
		expect(tutup).toHaveBeenCalledTimes(2);
		const arg = tutup.mock.calls[0][0] as any;
		expect(arg).toMatchObject({ checkinId: 'a', karyawanId: '135', method: 'auto_midnight' });
		expect(arg.checkOutAtOverride).toBe('2026-10-04T16:59:59.999Z'); // 23:59:59 WIB 4 Okt
	});

	it('satu baris gagal tidak menghentikan yang lain; penyebabnya ikut dikembalikan (maks 20) dan dilog', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		tutup.mockImplementation(async (a: any) => { if (a.checkinId === 'a') throw new Error('sinkron absensi gagal'); return {} as any; });
		const j = await (await panggil({ secret: 'rahasia' })).json();
		expect(j).toMatchObject({ checked: 2, closed: 1, failed: 1, gagal: [{ id: 'a', error: 'sinkron absensi gagal' }] });
		expect(err).toHaveBeenCalled();
		err.mockRestore();
	});

	it('tidak ada yang basi → semua nol', async () => {
		dx.mockResolvedValue({ data: [] });
		expect(await (await panggil({ secret: 'rahasia' })).json()).toEqual({ checked: 0, closed: 0, failed: 0, gagal: [] });
	});
});
