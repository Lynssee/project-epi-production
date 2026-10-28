// Paket 02 Site Visit Release (docs/(analyst) site visit/02_offline-idempotensi.md §3.9, §3.10,
// §6) — bukti bahwa replay offline check-in/checkout tidak lagi:
//   (H) melempar "Check-in sudah ditutup" pada retry checkout yang sebenarnya sudah sukses.
//   (G) menutup check-in yang SEDANG aktif dengan jam "sekarang" saat replay check-in offline
//       yang lebih tua tersinkron belakangan (durasi salah/hilang).
// Pola mock: sama seperti pettyCashRequest.test.ts — mock $lib/server/directus, route by URL.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJson = vi.fn();
const mockUpload = vi.fn();
vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...a: unknown[]) => mockJson(...a),
	directusServerUpload: (...a: unknown[]) => mockUpload(...a)
}));

const { closeCheckin, createCheckin } = await import('./siteCheckin');

// decodeURIComponent supaya pola seperti 'filter[status][_eq]=active' tetap cocok walau
// URLSearchParams meng-encode kurung siku jadi %5B/%5D di URL sungguhan.
const has = (u: unknown, ...n: string[]) => {
	const decoded = decodeURIComponent(String(u ?? ''));
	return n.every((x) => decoded.includes(x));
};

const SETTINGS = {
	max_durasi_jam: 16,
	min_durasi_menit: 15,
	tulis_balik_absensi_aktif: false,
	radius_default_m: 300
};

beforeEach(() => {
	mockJson.mockReset();
	mockUpload.mockReset();
});

describe('closeCheckin — idempotensi replay checkout (§3.9.3, worst case H)', () => {
	const existingBase = {
		id: 'chk-1',
		karyawan_id: '99',
		tipe_checkin: 'proyek',
		referensi_id: 5,
		nama_lokasi: 'Proyek A',
		check_in_at: '2026-09-29T01:00:00.000Z',
		status: 'completed' as const,
		checkout_method: 'manual',
		checkout_client_txn_id: 'txn-abc'
	};

	it('client_txn_id SAMA dengan yang tersimpan -> already_closed, TIDAK error, TIDAK PATCH lagi', async () => {
		mockJson.mockImplementation((url: string) => {
			if (has(url, '/items/site_checkin/chk-1') && !url.includes('?method'))
				return Promise.resolve({ data: existingBase });
			throw new Error(`URL tak terduga di test: ${url}`);
		});

		const result = await closeCheckin({
			checkinId: 'chk-1',
			karyawanId: '99',
			method: 'manual',
			lat: null,
			lng: null,
			akurasi: null,
			foto: null,
			clientTxnId: 'txn-abc'
		});

		expect(result.already_closed).toBe(true);
		expect(result.id).toBe('chk-1');
		// Hanya 1 panggilan (GET existing) — tidak ada PATCH, tidak ada sync payroll dijalankan lagi.
		expect(mockJson).toHaveBeenCalledTimes(1);
	});

	it('penutupan sebelumnya OTOMATIS (bukan manual) -> already_closed walau tanpa client_txn_id', async () => {
		mockJson.mockResolvedValue({ data: { ...existingBase, checkout_method: 'auto_next_checkin', checkout_client_txn_id: null } });

		const result = await closeCheckin({
			checkinId: 'chk-1',
			karyawanId: '99',
			method: 'manual',
			lat: null,
			lng: null,
			akurasi: null,
			foto: null
		});

		expect(result.already_closed).toBe(true);
	});

	it('konflik SUNGGUHAN (manual, client_txn_id beda/tidak ada) -> tetap melempar error', async () => {
		mockJson.mockResolvedValue({ data: existingBase });

		await expect(
			closeCheckin({
				checkinId: 'chk-1',
				karyawanId: '99',
				method: 'manual',
				lat: null,
				lng: null,
				akurasi: null,
				foto: null,
				clientTxnId: 'txn-berbeda'
			})
		).rejects.toThrow('Check-in sudah ditutup');
	});

	it('bukan pemilik check-in -> tetap melempar error (bukan disamakan dengan replay)', async () => {
		mockJson.mockResolvedValue({ data: { ...existingBase, karyawan_id: '1', status: 'active' } });
		await expect(
			closeCheckin({ checkinId: 'chk-1', karyawanId: '99', method: 'manual', lat: null, lng: null, akurasi: null, foto: null })
		).rejects.toThrow('bukan milik Anda');
	});
});

describe('closeCheckin — client_created_at untrusted dari checkout offline (§3.9.4)', () => {
	const activeExisting = {
		id: 'chk-2',
		karyawan_id: '99',
		tipe_checkin: 'proyek',
		referensi_id: 5,
		nama_lokasi: 'Proyek A',
		check_in_at: '2026-09-29T01:00:00.000Z',
		status: 'active' as const,
		checkout_method: null
	};

	function mockHappyPath(getRecord: Record<string, unknown>) {
		mockJson.mockImplementation((url: string, init?: RequestInit) => {
			if (has(url, '/items/site_checkin_settings')) return Promise.resolve({ data: SETTINGS });
			if (init?.method === 'PATCH' && has(url, '/items/site_checkin/chk-2')) {
				return Promise.resolve({ data: { ...getRecord, ...JSON.parse(String(init.body)) } });
			}
			if (has(url, '/items/site_checkin/chk-2')) return Promise.resolve({ data: getRecord });
			return Promise.resolve({ data: [] });
		});
	}

	it('client_created_at valid (dalam jendela check_in_at..now, <=24 jam) -> dipakai sebagai check_out_at', async () => {
		mockHappyPath(activeExisting);
		const clientTime = '2026-09-29T05:00:00.000Z'; // 4 jam setelah check-in, valid
		const result = await closeCheckin({
			checkinId: 'chk-2',
			karyawanId: '99',
			method: 'manual',
			lat: null,
			lng: null,
			akurasi: null,
			foto: null,
			clientCreatedAt: clientTime
		});
		expect(result.check_out_at).toBe(clientTime);
		expect(result.catatan_sistem ?? null).toBeFalsy();
	});

	it('client_created_at > 24 jam lalu (offline basi) -> pakai jam server + catatan_sistem', async () => {
		mockHappyPath(activeExisting);
		const clientTimeBasi = new Date(Date.now() - 30 * 3600 * 1000).toISOString(); // 30 jam lalu
		const result = await closeCheckin({
			checkinId: 'chk-2',
			karyawanId: '99',
			method: 'manual',
			lat: null,
			lng: null,
			akurasi: null,
			foto: null,
			clientCreatedAt: clientTimeBasi
		});
		expect(result.check_out_at).not.toBe(clientTimeBasi);
		expect(result.catatan_sistem).toContain('offline_terlambat_checkout');
	});

	it('checkOutAtOverride (sumber terpercaya, mis. auto_next_checkin) TIDAK divalidasi ulang', async () => {
		mockHappyPath(activeExisting);
		const overrideTime = '2026-09-29T02:00:00.000Z';
		const result = await closeCheckin({
			checkinId: 'chk-2',
			karyawanId: '99',
			method: 'auto_next_checkin',
			lat: null,
			lng: null,
			akurasi: null,
			foto: null,
			checkOutAtOverride: overrideTime
		});
		expect(result.check_out_at).toBe(overrideTime);
	});
});

describe('createCheckin — replay lebih tua dari check-in aktif (§3.10, worst case G)', () => {
	function fakeFile() {
		return new File([new Uint8Array([1, 2, 3])], 'checkin.jpg', { type: 'image/jpeg' });
	}

	function baseMock({ activeCheckin }: { activeCheckin: Record<string, unknown> | null }) {
		mockUpload.mockResolvedValue({ ok: true, json: async () => ({ data: { id: 'foto-1' } }) });
		mockJson.mockImplementation((url: string, init?: RequestInit) => {
			// dedup client_txn_id (createCheckin) -> tidak ada replay tersimpan
			if (has(url, '/items/site_checkin?', 'client_txn_id')) return Promise.resolve({ data: [] });
			// findActiveCheckin
			if (has(url, '/items/site_checkin?', "filter[status][_eq]=active")) {
				return Promise.resolve({ data: activeCheckin ? [activeCheckin] : [] });
			}
			if (has(url, '/items/projects/')) {
				return Promise.resolve({ data: { id: 5, name: 'Proyek A', tier_absensi: null, geo_lat: null, geo_lng: null, geo_radius_m: null } });
			}
			if (has(url, '/items/site_checkin_settings')) return Promise.resolve({ data: SETTINGS });
			if (has(url, '/items/lokasi_absensi')) return Promise.resolve({ data: [] }); // getKantorPusat
			// GET existing untuk closeCheckin (baik yang aktif lama, maupun baris baru)
			if (init?.method === undefined && has(url, '/items/site_checkin/')) {
				const id = url.split('/items/site_checkin/')[1]?.split('?')[0];
				if (activeCheckin && id === (activeCheckin as any).id) return Promise.resolve({ data: activeCheckin });
				return Promise.resolve({ data: { id, karyawan_id: '99', status: 'active', check_in_at: '2026-09-29T01:00:00.000Z' } });
			}
			// PATCH (closeCheckin menutup salah satu baris)
			if (init?.method === 'PATCH') {
				return Promise.resolve({ data: { id: 'patched', ...JSON.parse(String(init.body)) } });
			}
			// POST baris baru
			if (init?.method === 'POST' && has(url, '/items/site_checkin')) {
				return Promise.resolve({ data: { id: 'chk-new', status: 'active', karyawan_id: '99', check_in_at: JSON.parse(String(init.body)).check_in_at } });
			}
			return Promise.resolve({ data: [] });
		});
	}

	it('replay LEBIH TUA dari check-in aktif -> baris BARU yang ditutup, bukan yang aktif (durasi tidak nyasar ke "sekarang")', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const activeExisting = {
			id: 'chk-aktif',
			karyawan_id: '99',
			status: 'active',
			check_in_at: '2026-09-29T05:00:00.000Z' // aktif dimulai jam 05:00
		};
		baseMock({ activeCheckin: activeExisting });

		const patchCalls: { url: string; body: any }[] = [];
		mockJson.mockImplementation((url: string, init?: RequestInit) => {
			if (has(url, '/items/site_checkin?', 'client_txn_id')) return Promise.resolve({ data: [] });
			if (has(url, '/items/site_checkin?', 'filter[status][_eq]=active')) return Promise.resolve({ data: [activeExisting] });
			if (has(url, '/items/projects/')) return Promise.resolve({ data: { id: 5, name: 'Proyek A', tier_absensi: null, geo_lat: null, geo_lng: null, geo_radius_m: null } });
			if (has(url, '/items/site_checkin_settings')) return Promise.resolve({ data: SETTINGS });
			if (has(url, '/items/lokasi_absensi')) return Promise.resolve({ data: [] });
			if (init?.method === 'POST' && has(url, '/items/site_checkin')) {
				const body = JSON.parse(String(init.body));
				return Promise.resolve({ data: { id: 'chk-new', status: 'active', karyawan_id: '99', check_in_at: body.check_in_at } });
			}
			if (init?.method === 'PATCH') {
				const body = JSON.parse(String(init.body));
				patchCalls.push({ url, body });
				return Promise.resolve({ data: { id: 'patched', status: 'completed', ...body } });
			}
			// GET existing by id — untuk closeCheckin (dipanggil dengan checkinId = 'chk-new')
			if (has(url, '/items/site_checkin/chk-new')) {
				return Promise.resolve({ data: { id: 'chk-new', karyawan_id: '99', status: 'active', check_in_at: '2026-09-29T02:00:00.000Z' } });
			}
			return Promise.resolve({ data: [] });
		});

		// Check-in offline yang baru tersinkron ini SEBENARNYA terjadi jam 02:00 — LEBIH TUA
		// dari check-in aktif yang mulai jam 05:00.
		await createCheckin({
			karyawanId: '99',
			referensiId: 5,
			lat: -6.2,
			lng: 106.8,
			akurasi: 10,
			foto: fakeFile(),
			clientCreatedAt: '2026-09-29T02:00:00.000Z',
			clientTxnId: 'txn-replay-tua'
		});

		// Yang aktif (chk-aktif) TIDAK boleh disentuh (tidak ada PATCH ke chk-aktif).
		const patchKeAktif = patchCalls.find((p) => p.url.includes('chk-aktif'));
		expect(patchKeAktif).toBeUndefined();

		// Baris BARU (chk-new) yang ditutup, checkOutAtOverride = jam yang aktif mulai (05:00) —
		// bukan "sekarang" — supaya durasinya benar (02:00 -> 05:00 = 3 jam), bukan 0/salah.
		errSpy.mockRestore();
		const patchKeBaru = patchCalls.find((p) => p.url.includes('chk-new'));
		expect(patchKeBaru).toBeDefined();
		expect(patchKeBaru!.body.check_out_at).toBe('2026-09-29T05:00:00.000Z');
		expect(patchKeBaru!.body.catatan_sistem).toContain('replay_offline_urutan');
	});

	it('replay LEBIH BARU/SAMA dengan aktif -> perilaku lama: yang aktif ditutup TEPAT saat baru mulai', async () => {
		mockUpload.mockResolvedValue({ ok: true, json: async () => ({ data: { id: 'foto-1' } }) });
		const activeExisting = {
			id: 'chk-aktif',
			karyawan_id: '99',
			status: 'active',
			check_in_at: '2026-09-29T01:00:00.000Z'
		};
		const patchCalls: { url: string; body: any }[] = [];
		mockJson.mockImplementation((url: string, init?: RequestInit) => {
			if (has(url, '/items/site_checkin?', 'client_txn_id')) return Promise.resolve({ data: [] });
			if (has(url, '/items/site_checkin?', 'filter[status][_eq]=active')) return Promise.resolve({ data: [activeExisting] });
			if (has(url, '/items/projects/')) return Promise.resolve({ data: { id: 5, name: 'Proyek A', tier_absensi: null, geo_lat: null, geo_lng: null, geo_radius_m: null } });
			if (has(url, '/items/site_checkin_settings')) return Promise.resolve({ data: SETTINGS });
			if (has(url, '/items/lokasi_absensi')) return Promise.resolve({ data: [] });
			if (init?.method === 'POST' && has(url, '/items/site_checkin')) {
				const body = JSON.parse(String(init.body));
				return Promise.resolve({ data: { id: 'chk-new', status: 'active', karyawan_id: '99', check_in_at: body.check_in_at } });
			}
			if (init?.method === 'PATCH') {
				const body = JSON.parse(String(init.body));
				patchCalls.push({ url, body });
				return Promise.resolve({ data: { id: 'patched', status: 'completed', ...body } });
			}
			if (has(url, '/items/site_checkin/chk-aktif')) {
				return Promise.resolve({ data: activeExisting });
			}
			return Promise.resolve({ data: [] });
		});

		// Check-in baru jam 03:00 — LEBIH BARU dari yang aktif (01:00).
		await createCheckin({
			karyawanId: '99',
			referensiId: 5,
			lat: -6.2,
			lng: 106.8,
			akurasi: 10,
			foto: fakeFile(),
			clientCreatedAt: '2026-09-29T03:00:00.000Z',
			clientTxnId: 'txn-replay-baru'
		});

		const patchKeAktif = patchCalls.find((p) => p.url.includes('chk-aktif'));
		expect(patchKeAktif).toBeDefined();
		// Ditutup TEPAT saat yang baru mulai (03:00) — bukan "sekarang" (real time test).
		expect(patchKeAktif!.body.check_out_at).toBe('2026-09-29T03:00:00.000Z');

		const patchKeBaru = patchCalls.find((p) => p.url.includes('chk-new'));
		expect(patchKeBaru).toBeUndefined(); // baris baru TIDAK ditutup — dia yang sekarang aktif
	});
});
