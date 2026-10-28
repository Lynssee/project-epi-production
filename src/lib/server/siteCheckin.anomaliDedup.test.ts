// Paket 05 Site Visit Release §3.1/§3.2 — dedup notifikasi visit_anomali & ambang durasi konsisten.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJson = vi.fn();
const mockUpload = vi.fn();
vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...a: unknown[]) => mockJson(...a),
	directusServerUpload: (...a: unknown[]) => mockUpload(...a)
}));
vi.mock('$lib/server/visitLeaderBridge', () => ({ bridgeToVisitLeader: vi.fn() }));
vi.mock('$lib/server/visitMarketingBridge', () => ({ bridgeToVisitMarketing: vi.fn() }));
vi.mock('$lib/server/visitMaintenanceBridge', () => ({ bridgeToVisitMaintenance: vi.fn() }));
vi.mock('$lib/server/projectNotify', () => ({
	notifyProjectSiteCheckin: vi.fn(() => Promise.resolve()),
	notifyProjectSiteCheckout: vi.fn(() => Promise.resolve())
}));

const { closeCheckin } = await import('./siteCheckin');

const has = (u: unknown, ...n: string[]) => n.every((x) => decodeURIComponent(String(u ?? '')).includes(x));

const SETTINGS = {
	tulis_balik_absensi_aktif: false, // matikan jembatan payroll — fokus test ke notifikasi anomali saja
	max_durasi_jam: 16,
	min_durasi_menit: 15,
	anomali_cooldown_hari: 7
};

const EXISTING_CHECKIN = {
	id: 'chk-1',
	karyawan_id: '10',
	status: 'active',
	check_in_at: new Date(Date.now() - 20 * 60000).toISOString(), // 20 menit lalu
	tier_absensi: null,
	area_status: null,
	nama_lokasi: 'Proyek Uji',
	tipe_checkin: 'proyek',
	referensi_id: 5
};

function setupMock({ dedupHit }: { dedupHit: boolean }) {
	const posted: any[] = [];
	mockJson.mockImplementation((u: string, opts?: any) => {
		if (has(u, '/items/site_checkin/chk-1') && (!opts || opts.method !== 'PATCH')) {
			return Promise.resolve({ data: EXISTING_CHECKIN });
		}
		if (has(u, 'site_checkin_settings')) return Promise.resolve({ data: SETTINGS });
		if (opts?.method === 'PATCH' && has(u, '/items/site_checkin/chk-1')) {
			// PATCH check-out — durasi 20 menit dalam skenario < 30 (default lama) tapi > min_durasi_menit(15)
			return Promise.resolve({
				data: { ...EXISTING_CHECKIN, durasi_menit: 20, in_geofence: false, anti_fake_gps_score: 0.9, status: 'completed' }
			});
		}
		if (has(u, '/items/app_notifications') && !opts) {
			// GET dedup query
			return Promise.resolve({ data: dedupHit ? [{ id: 999 }] : [] });
		}
		if (opts?.method === 'POST' && has(u, '/items/app_notifications')) {
			posted.push(JSON.parse(opts.body));
			return Promise.resolve({ data: { id: 1 } });
		}
		return Promise.resolve({ data: [] });
	});
	return posted;
}

beforeEach(() => {
	mockJson.mockReset();
	mockUpload.mockReset();
});

describe('closeCheckin — §3.2 ambang durasi anomali konsisten dengan payroll', () => {
	it('durasi 20 menit (>= min_durasi_menit=15, < 30 lama) TIDAK dianggap durasiRendah, tapi tetap notif karena luar geofence', async () => {
		const posted = setupMock({ dedupHit: false });
		await closeCheckin({
			checkinId: 'chk-1',
			karyawanId: '10',
			method: 'manual',
			lat: -6.2,
			lng: 106.8,
			akurasi: 10,
			foto: null
		});
		// beri waktu untuk IIFE fail-soft async selesai
		await new Promise((r) => setTimeout(r, 0));
		expect(posted.length).toBe(1);
		expect(posted[0].message).not.toContain('di bawah minimum');
		expect(posted[0].message).toContain('di luar geofence');
	});
});

describe('closeCheckin — §3.1 dedup notifikasi visit_anomali (SVR-20)', () => {
	it('sudah ada notifikasi visit_anomali untuk karyawan+lokasi sama dalam cooldown -> TIDAK kirim lagi', async () => {
		const posted = setupMock({ dedupHit: true });
		await closeCheckin({
			checkinId: 'chk-1',
			karyawanId: '10',
			method: 'manual',
			lat: -6.2,
			lng: 106.8,
			akurasi: 10,
			foto: null
		});
		await new Promise((r) => setTimeout(r, 0));
		expect(posted.length).toBe(0);
	});

	it('belum ada notifikasi sebelumnya -> kirim seperti biasa', async () => {
		const posted = setupMock({ dedupHit: false });
		await closeCheckin({
			checkinId: 'chk-1',
			karyawanId: '10',
			method: 'manual',
			lat: -6.2,
			lng: 106.8,
			akurasi: 10,
			foto: null
		});
		await new Promise((r) => setTimeout(r, 0));
		expect(posted.length).toBe(1);
	});
});
