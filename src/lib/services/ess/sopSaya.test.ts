import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/secureDirectus', () => ({ getIdToken: vi.fn(async () => 'tok') }));
import { clearSopSayaCache, getSopSaya, sopStateInfo } from './sopSaya';

const fetchMock = vi.fn();
beforeEach(() => { clearSopSayaCache(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());
const ok = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => body });

describe('getSopSaya', () => {
	it('mengirim token & meng-cache 2 menit (dua kartu/halaman = satu panggilan)', async () => {
		fetchMock.mockResolvedValue(ok({ available: true, terhubung: true }));
		const [a, b] = await Promise.all([getSopSaya(), getSopSaya()]);
		expect(a).toBe(b);
		await getSopSaya();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
		await getSopSaya(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
	it('gagal (HTTP / jaringan) menghasilkan available:false dan TIDAK di-cache', async () => {
		fetchMock.mockResolvedValueOnce(ok({}, 500)).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(ok({ available: true }));
		expect((await getSopSaya()).available).toBe(false);
		await Promise.resolve();
		expect((await getSopSaya()).available).toBe(false);
		await Promise.resolve();
		expect((await getSopSaya()).available).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});

describe('sopStateInfo', () => {
	it('label ramah per status', () => {
		expect(sopStateInfo('lulus')).toEqual({ label: 'Lulus', tone: 'ok' });
		expect(sopStateInfo('tenggang').label).toBe('Sedang berjalan');
		expect(sopStateInfo('belum').tone).toBe('belum');
		expect(sopStateInfo('tidak_terdaftar').label).toBe('Belum terdaftar');
	});
});
