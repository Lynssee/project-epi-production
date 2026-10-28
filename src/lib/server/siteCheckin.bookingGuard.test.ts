// Paket 07 Site Visit Release §3.1 (SVR-14) — tipe_checkin selalu tipe asli, booking divalidasi
// (bukan dipasang buta), referensi_site_visit_id hanya diisi bila kosong.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJson = vi.fn();
const mockUpload = vi.fn();
vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...a: unknown[]) => mockJson(...a),
	directusServerUpload: (...a: unknown[]) => mockUpload(...a)
}));
vi.mock('$lib/server/visitLeaderBridge', () => ({ bridgeToVisitLeader: vi.fn(() => Promise.resolve({ created: false, visitLeaderId: null })) }));
vi.mock('$lib/server/visitMarketingBridge', () => ({ bridgeToVisitMarketing: vi.fn() }));
vi.mock('$lib/server/visitMaintenanceBridge', () => ({ bridgeToVisitMaintenance: vi.fn() }));
vi.mock('$lib/server/projectNotify', () => ({
	notifyProjectSiteCheckin: vi.fn(() => Promise.resolve()),
	notifyProjectSiteCheckout: vi.fn(() => Promise.resolve())
}));

const { createCheckin } = await import('./siteCheckin');

const has = (u: unknown, ...n: string[]) => n.every((x) => decodeURIComponent(String(u ?? '')).includes(x));

const PROJECT = { id: 5, name: 'Proyek Uji', tier_absensi: 'Jabodetabek', geo_lat: -6.2, geo_lng: 106.8, geo_radius_m: 100 };
const SETTINGS = { radius_default_m: 100 };

function fakeFile(): File {
	return new File([new Uint8Array([1, 2, 3])], 'foto.jpg', { type: 'image/jpeg' });
}

function setupMock({ booking }: { booking: any }) {
	const posted: any[] = [];
	const patched: { url: string; body: any }[] = [];
	mockUpload.mockResolvedValue({ ok: true, json: async () => ({ data: { id: 'foto-1' } }) });
	mockJson.mockImplementation((u: string, opts?: any) => {
		if (has(u, '/items/fleet_bookings/') && (!opts || opts.method === undefined)) {
			return Promise.resolve({ data: booking });
		}
		if (has(u, '/items/projects/5')) return Promise.resolve({ data: PROJECT });
		if (has(u, 'site_checkin_settings')) return Promise.resolve({ data: SETTINGS });
		if (has(u, '/items/lokasi_absensi')) return Promise.resolve({ data: [{ lat: -6.1, lng: 106.7 }] });
		if (has(u, '/items/site_checkin') && (!opts || opts.method === undefined)) {
			// findActiveCheckin / dedup / anti-fraud queries — semua kosong
			return Promise.resolve({ data: [] });
		}
		if (opts?.method === 'POST' && has(u, '/items/site_checkin')) {
			const body = JSON.parse(opts.body);
			posted.push(body);
			return Promise.resolve({ data: { ...body, id: 'chk-new' } });
		}
		if (opts?.method === 'PATCH' && has(u, '/items/fleet_bookings/')) {
			patched.push({ url: u, body: JSON.parse(opts.body) });
			return Promise.resolve({ data: {} });
		}
		return Promise.resolve({ data: [] });
	});
	return { posted, patched };
}

beforeEach(() => {
	mockJson.mockReset();
	mockUpload.mockReset();
});

describe('createCheckin — §3.1 validasi booking', () => {
	it('booking bukan milik karyawan ini -> diabaikan, tipe_checkin tetap proyek, booking_id null', async () => {
		const { posted } = setupMock({
			booking: { id: 'bk-1', karyawan_id: '999', tipe_keperluan: 'site_visit', status: 'disetujui', project_id: null }
		});
		await createCheckin({
			karyawanId: '10',
			referensiId: 5,
			lat: -6.2,
			lng: 106.8,
			akurasi: 10,
			foto: fakeFile(),
			bookingId: 'bk-1'
		});
		expect(posted.length).toBe(1);
		expect(posted[0].tipe_checkin).toBe('proyek');
		expect(posted[0].booking_id).toBeNull();
		expect(posted[0].catatan_sistem).toContain('booking_diabaikan');
	});

	it('booking valid milik karyawan -> tipe_checkin tetap proyek (BUKAN peminjaman_kendaraan), booking_id terisi', async () => {
		const { posted, patched } = setupMock({
			booking: { id: 'bk-2', karyawan_id: '10', tipe_keperluan: 'site_visit', status: 'disetujui', project_id: 5 }
		});
		await createCheckin({
			karyawanId: '10',
			referensiId: 5,
			lat: -6.2,
			lng: 106.8,
			akurasi: 10,
			foto: fakeFile(),
			bookingId: 'bk-2'
		});
		await new Promise((r) => setTimeout(r, 0)); // tunggu IIFE tulis-balik fail-soft
		expect(posted[0].tipe_checkin).toBe('proyek');
		expect(posted[0].booking_id).toBe('bk-2');
		// referensi_site_visit_id diisi karena booking belum punya kunjungan sebelumnya
		expect(patched.some((p) => p.body.referensi_site_visit_id === 'chk-new')).toBe(true);
	});

	it('booking sudah punya referensi_site_visit_id -> TIDAK ditimpa (booking multi-kunjungan)', async () => {
		mockUpload.mockResolvedValue({ ok: true, json: async () => ({ data: { id: 'foto-1' } }) });
		const patched: { body: any }[] = [];
		mockJson.mockImplementation((u: string, opts?: any) => {
			if (has(u, '/items/fleet_bookings/bk-3') && opts?.method === 'PATCH') {
				patched.push({ body: JSON.parse(opts.body) });
				return Promise.resolve({ data: {} });
			}
			if (has(u, '/items/fleet_bookings/bk-3')) {
				// GET awal (validasi) vs GET tulis-balik (fields status,butuh_kendaraan,referensi_site_visit_id)
				if (has(u, 'referensi_site_visit_id')) {
					return Promise.resolve({ data: { status: 'disetujui', butuh_kendaraan: true, referensi_site_visit_id: 'chk-lama' } });
				}
				return Promise.resolve({ data: { id: 'bk-3', karyawan_id: '10', tipe_keperluan: 'site_visit', status: 'disetujui', project_id: 5 } });
			}
			if (has(u, '/items/projects/5')) return Promise.resolve({ data: PROJECT });
			if (has(u, 'site_checkin_settings')) return Promise.resolve({ data: SETTINGS });
			if (has(u, '/items/lokasi_absensi')) return Promise.resolve({ data: [{ lat: -6.1, lng: 106.7 }] });
			if (opts?.method === 'POST' && has(u, '/items/site_checkin')) {
				return Promise.resolve({ data: { ...JSON.parse(opts.body), id: 'chk-new-2' } });
			}
			return Promise.resolve({ data: [] });
		});
		await createCheckin({
			karyawanId: '10',
			referensiId: 5,
			lat: -6.2,
			lng: 106.8,
			akurasi: 10,
			foto: fakeFile(),
			bookingId: 'bk-3'
		});
		await new Promise((r) => setTimeout(r, 0));
		// referensi_site_visit_id TIDAK ikut di-patch karena sudah terisi 'chk-lama'
		expect(patched.every((p) => !('referensi_site_visit_id' in p.body))).toBe(true);
	});
});
