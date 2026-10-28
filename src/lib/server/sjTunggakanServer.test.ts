import { describe, it, expect, vi, beforeEach } from 'vitest';

const directus = vi.fn();
vi.mock('./directus', () => ({ directusServerJson: (...a: unknown[]) => directus(...a) }));
vi.mock('./inventorySettings', () => ({ getInventorySettingServer: async (k: string, fb: unknown) => (k.includes('enforce_from') ? '' : fb) }));

const { getSjTunggakanMode, checkCreateBlockedByTunggakan } = await import('./sjTunggakanServer');

beforeEach(() => directus.mockReset());

describe('getSjTunggakanMode', () => {
	it('tanpa baris / nonaktif -> shadow', async () => {
		directus.mockResolvedValueOnce({ data: [] });
		expect(await getSjTunggakanMode()).toBe('shadow');
		directus.mockResolvedValueOnce({ data: [{ mode: 'hard', enforce_from: null, is_active: 0 }] });
		expect(await getSjTunggakanMode()).toBe('shadow');
	});
	it('hard sebelum enforce_from dipaksa soft', async () => {
		directus.mockResolvedValueOnce({ data: [{ mode: 'hard', enforce_from: '2999-01-01', is_active: 1 }] });
		expect(await getSjTunggakanMode()).toBe('soft');
	});
});

describe('checkCreateBlockedByTunggakan', () => {
	it('mode soft -> tidak memblokir & tidak menghitung tunggakan', async () => {
		directus.mockResolvedValueOnce({ data: [{ mode: 'soft', enforce_from: null, is_active: 1 }] });
		expect(await checkCreateBlockedByTunggakan(7)).toBeNull();
		expect(directus).toHaveBeenCalledTimes(1);
	});
	it('mode hard & melebihi kuota -> pesan blokir', async () => {
		directus.mockResolvedValueOnce({ data: [{ mode: 'hard', enforce_from: null, is_active: 1 }] });
		const old = '2026-10-01T08:00:00';
		directus.mockResolvedValueOnce({ data: [1, 2, 3, 4].map((id) => ({ id, nomor_sj: `SJ-${id}`, received_at: old })) });
		directus.mockResolvedValueOnce({ data: [] }); // rangkap
		const msg = await checkCreateBlockedByTunggakan(7);
		expect(msg).toContain('4 Surat Jalan');
	});
	it('respons kosong dari Directus -> tidak memblokir (fail-open)', async () => {
		directus.mockResolvedValueOnce({ data: [{ mode: 'hard', enforce_from: null, is_active: 1 }] });
		directus.mockResolvedValueOnce(null);
		expect(await checkCreateBlockedByTunggakan(7)).toBeNull();
	});
});
