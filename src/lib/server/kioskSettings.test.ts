import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scryptSync, randomBytes } from 'node:crypto';

const directusServerJson = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => directusServerJson(...a) }));
vi.mock('$env/dynamic/private', () => ({ env: { KIOSK_SESSION_SECRET: 'x', WORKSTATION_HMAC_SECRET: 'y' } }));

import { readKioskSettings, _resetKioskSettingsCache } from './kioskSettings';
import { verifyPin } from './kioskAuth';

beforeEach(() => {
	directusServerJson.mockReset();
	_resetKioskSettingsCache();
});

describe('readKioskSettings', () => {
	it('membaca semua key dengan SATU query dan meng-cache hasilnya', async () => {
		directusServerJson.mockResolvedValue({
			data: [
				{ setting_key: 'kiosk.session_timeout_minutes', setting_value: '10' },
				{ setting_key: 'kiosk.enabled', setting_value: 'true' },
				{ setting_key: 'kiosk.session_timeout_per_menu', setting_value: '{"gudang/opname":30}' }
			]
		});
		const a = await readKioskSettings();
		const b = await readKioskSettings();
		expect(a).toEqual({ timeoutMinutes: 10, kioskEnabled: true, timeoutPerMenu: { 'gudang/opname': 30 } });
		expect(b).toEqual(a);
		expect(directusServerJson).toHaveBeenCalledTimes(1);
		expect(directusServerJson.mock.calls[0][0]).toContain('filter[setting_key][_in]=');
	});

	it('permintaan bersamaan tetap satu query', async () => {
		directusServerJson.mockResolvedValue({ data: [] });
		await Promise.all([readKioskSettings(), readKioskSettings(), readKioskSettings()]);
		expect(directusServerJson).toHaveBeenCalledTimes(1);
	});

	it('default sama dengan perilaku lama: baris kosong / rusak → 5 menit, aktif, {}', async () => {
		directusServerJson.mockResolvedValue({
			data: [
				{ setting_key: 'kiosk.session_timeout_minutes', setting_value: 'abc' },
				{ setting_key: 'kiosk.session_timeout_per_menu', setting_value: '[1,2]' }
			]
		});
		expect(await readKioskSettings()).toEqual({ timeoutMinutes: 5, kioskEnabled: true, timeoutPerMenu: {} });
	});

	it('kiosk.enabled hanya mati bila eksplisit false', async () => {
		directusServerJson.mockResolvedValue({ data: [{ setting_key: 'kiosk.enabled', setting_value: 'false' }] });
		expect((await readKioskSettings()).kioskEnabled).toBe(false);
	});

	it('gagal baca → default, dan TIDAK di-cache (request berikutnya mencoba lagi)', async () => {
		directusServerJson.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({
			data: [{ setting_key: 'kiosk.session_timeout_minutes', setting_value: '7' }]
		});
		expect((await readKioskSettings()).timeoutMinutes).toBe(5);
		expect((await readKioskSettings()).timeoutMinutes).toBe(7);
		expect(directusServerJson).toHaveBeenCalledTimes(2);
	});
});

describe('verifyPin (async)', () => {
	// Format hash dibuat persis seperti erp-epi-1 (scryptSync default) — harus tetap cocok.
	const salt = randomBytes(16);
	const stored = `scrypt:${salt.toString('hex')}:${scryptSync('123456', salt, 64).toString('hex')}`;

	it('PIN benar → true', async () => {
		expect(await verifyPin('123456', stored)).toBe(true);
	});
	it('PIN salah → false', async () => {
		expect(await verifyPin('654321', stored)).toBe(false);
	});
	it('hash kosong / format rusak → false', async () => {
		expect(await verifyPin('123456', null)).toBe(false);
		expect(await verifyPin('123456', 'bcrypt:xx')).toBe(false);
		expect(await verifyPin('123456', 'scrypt:zz:zz')).toBe(false);
	});
});
