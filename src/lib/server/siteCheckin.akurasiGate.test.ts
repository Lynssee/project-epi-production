// Paket 04 Site Visit Release §3.3 — gate akurasi GPS vs sinkron payroll.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJson = vi.fn();
vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...a: unknown[]) => mockJson(...a),
	directusServerUpload: vi.fn()
}));
vi.mock('$lib/server/visitLeaderBridge', () => ({ bridgeToVisitLeader: vi.fn() }));
vi.mock('$lib/server/visitMarketingBridge', () => ({ bridgeToVisitMarketing: vi.fn() }));
vi.mock('$lib/server/visitMaintenanceBridge', () => ({ bridgeToVisitMaintenance: vi.fn() }));
vi.mock('$lib/server/projectNotify', () => ({ notifyProjectSiteCheckin: vi.fn(), notifyProjectSiteCheckout: vi.fn() }));

const { syncAbsensiLokasi, modeAkurasiEfektif } = await import('./siteCheckin');

const has = (u: unknown, ...n: string[]) => n.every((x) => decodeURIComponent(String(u ?? '')).includes(x));

const SETTINGS_BASE = {
	tulis_balik_absensi_aktif: true,
	tulis_balik_butuh_verifikasi: false,
	akurasi_maks_m: 500,
	akurasi_mode: 'soft' as const,
	akurasi_enforce_from: '2020-01-01' // sudah lewat -> mode efektif = 'soft'
};

beforeEach(() => {
	mockJson.mockReset();
});

describe('modeAkurasiEfektif — Aturan #3 (anti-lockdown retroaktif)', () => {
	it('mode bukan hard/soft -> shadow', () => {
		expect(modeAkurasiEfektif('shadow', '2020-01-01')).toBe('shadow');
		expect(modeAkurasiEfektif(null, '2020-01-01')).toBe('shadow');
	});
	it('enforce_from kosong -> shadow walau mode hard', () => {
		expect(modeAkurasiEfektif('hard', null)).toBe('shadow');
	});
	it('sebelum enforce_from -> shadow', () => {
		const besok = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
		expect(modeAkurasiEfektif('hard', besok)).toBe('shadow');
	});
	it('sudah lewat enforce_from -> mode aslinya', () => {
		expect(modeAkurasiEfektif('hard', '2020-01-01')).toBe('hard');
		expect(modeAkurasiEfektif('soft', '2020-01-01')).toBe('soft');
	});
});

describe('syncAbsensiLokasi — §3.3 anomali akurasi_gps_rendah', () => {
	it('akurasi buruk + mode soft aktif -> tidak sync, anomali akurasi_gps_rendah (tidak sampai cek tier)', async () => {
		mockJson.mockImplementation((u: string) => {
			if (has(u, 'site_checkin_settings')) return Promise.resolve({ data: SETTINGS_BASE });
			throw new Error('tidak boleh dipanggil lagi setelah gate akurasi');
		});
		const r = await syncAbsensiLokasi(
			{ karyawan_id: '1', tier_absensi: null, area_status: null, akurasi_in_m: 2044 },
			'2026-09-29'
		);
		expect(r).toEqual({ synced: false, absensiHarianId: null, anomali: 'akurasi_gps_rendah' });
	});

	it('akurasi buruk tapi mode shadow (belum enforce_from) -> lanjut seperti biasa', async () => {
		mockJson.mockImplementation((u: string) => {
			if (has(u, 'site_checkin_settings')) {
				return Promise.resolve({ data: { ...SETTINGS_BASE, akurasi_enforce_from: null } });
			}
			throw new Error('unexpected: ' + u);
		});
		const r = await syncAbsensiLokasi(
			{ karyawan_id: '1', tier_absensi: null, area_status: null, akurasi_in_m: 2044 },
			'2026-09-29'
		);
		// Lanjut ke cek tier (null) -> anomali 'tier_tidak_diketahui', BUKAN akurasi_gps_rendah
		expect(r.anomali).toBe('tier_tidak_diketahui');
	});

	it('akurasi baik -> tidak masuk cabang gate sama sekali', async () => {
		mockJson.mockImplementation((u: string) => {
			if (has(u, 'site_checkin_settings')) return Promise.resolve({ data: SETTINGS_BASE });
			throw new Error('unexpected: ' + u);
		});
		const r = await syncAbsensiLokasi(
			{ karyawan_id: '1', tier_absensi: null, area_status: null, akurasi_in_m: 20 },
			'2026-09-29'
		);
		expect(r.anomali).toBe('tier_tidak_diketahui');
	});

	it('paksa:true (resync HRD) -> lewati gate akurasi meski mode soft aktif', async () => {
		mockJson.mockImplementation((u: string) => {
			if (has(u, 'site_checkin_settings')) return Promise.resolve({ data: SETTINGS_BASE });
			throw new Error('unexpected: ' + u);
		});
		const r = await syncAbsensiLokasi(
			{ karyawan_id: '1', tier_absensi: null, area_status: null, akurasi_in_m: 2044 },
			'2026-09-29',
			{ paksa: true }
		);
		expect(r.anomali).toBe('tier_tidak_diketahui'); // lolos gate akurasi, lanjut cek tier
	});

	it('tulis_balik_absensi_aktif=false -> selalu synced:false tanpa peduli akurasi (kill-switch lama tetap menang)', async () => {
		mockJson.mockImplementation((u: string) => {
			if (has(u, 'site_checkin_settings')) return Promise.resolve({ data: { ...SETTINGS_BASE, tulis_balik_absensi_aktif: false } });
			throw new Error('tidak boleh dipanggil');
		});
		const r = await syncAbsensiLokasi(
			{ karyawan_id: '1', tier_absensi: 'Jabodetabek', area_status: 'diterapkan', akurasi_in_m: 2044 },
			'2026-09-29'
		);
		expect(r).toEqual({ synced: false, absensiHarianId: null, anomali: null });
	});
});
