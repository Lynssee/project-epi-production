import { describe, it, expect, vi, beforeEach } from 'vitest';

const directusServerJson = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: unknown[]) => directusServerJson(...a) }));

const { normalizeRemedialInterval, computeRemedialTenggat, getRemedialTenggat } = await import('./trainingRemedial');

beforeEach(() => {
	directusServerJson.mockReset();
});

describe('trainingRemedial', () => {
	it('normalisasi interval: invalid/<=0 → 0, batas 90, desimal dibulatkan ke bawah', () => {
		expect(normalizeRemedialInterval(undefined)).toBe(0);
		expect(normalizeRemedialInterval('abc')).toBe(0);
		expect(normalizeRemedialInterval(-3)).toBe(0);
		expect(normalizeRemedialInterval('7')).toBe(7);
		expect(normalizeRemedialInterval(7.9)).toBe(7);
		expect(normalizeRemedialInterval(500)).toBe(90);
	});

	it('tenggat memakai kalender WIB (UTC 18:00 sudah hari berikutnya di WIB)', () => {
		expect(computeRemedialTenggat(new Date('2026-11-16T10:00:00Z'), 7)).toBe('2026-11-23');
		expect(computeRemedialTenggat(new Date('2026-11-16T18:00:00Z'), 7)).toBe('2026-11-24');
		expect(computeRemedialTenggat(new Date('2026-12-28T10:00:00Z'), 7)).toBe('2027-01-04');
		expect(computeRemedialTenggat(new Date(), 0)).toBeNull();
	});

	it('getRemedialTenggat: setelan 0/kosong → null (fitur mati)', async () => {
		directusServerJson.mockResolvedValue({ data: [] });
		expect(await getRemedialTenggat()).toBeNull();
		directusServerJson.mockResolvedValue({ data: [{ setting_value: '0' }] });
		expect(await getRemedialTenggat()).toBeNull();
	});

	it('getRemedialTenggat: interval 3 → tanggal', async () => {
		directusServerJson.mockResolvedValue({ data: [{ setting_value: '3' }] });
		expect(await getRemedialTenggat(new Date('2026-11-16T10:00:00Z'))).toBe('2026-11-19');
	});

	it('getRemedialTenggat: Directus gagal → null + log, tidak melempar', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		directusServerJson.mockImplementation(() => Promise.reject(new Error('boom')));
		expect(await getRemedialTenggat()).toBeNull();
		expect(spy).toHaveBeenCalledTimes(1);
		spy.mockRestore();
	});
});
