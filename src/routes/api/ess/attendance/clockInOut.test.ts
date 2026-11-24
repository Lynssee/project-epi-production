import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDirectusJson = vi.fn();
const mockDirectusUpload = vi.fn();
const mockAuthenticateEss = vi.fn();
const mockFindActiveCheckin = vi.fn();

vi.mock('$env/dynamic/private', () => ({
	env: { FACE_SERVICE_URL: '' }
}));

vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...args: unknown[]) => mockDirectusJson(...args),
	directusServerUpload: (...args: unknown[]) => mockDirectusUpload(...args)
}));

vi.mock('$lib/server/ess/attendanceGuard', () => ({
	authenticateEss: (...args: unknown[]) => mockAuthenticateEss(...args)
}));

vi.mock('$lib/server/siteCheckin', () => ({
	findActiveCheckin: (...args: unknown[]) => mockFindActiveCheckin(...args)
}));

const { POST: clockInPOST } = await import('./clock-in/+server');
const { POST: clockOutPOST } = await import('./clock-out/+server');
const { clearLokasiCache } = await import('$lib/server/ess/absensi');
const { clearFaceVerifyCache } = await import('$lib/server/ess/faceVerify');
const { clearPhoneDepositSettingsCache } = await import('$lib/server/phoneDepositGate');
const { clearIstirahatCache } = await import('$lib/server/ess/istirahat');
const { invalidateFieldGateEnforcementCache } = await import('$lib/server/gateEnforcement');

function buildAttendanceEvent(fields: Record<string, string> = {}) {
	const fd = new FormData();
	fd.set('lat', fields.lat ?? '-6.2000');
	fd.set('lng', fields.lng ?? '106.8000');
	fd.set('accuracy', fields.accuracy ?? '12');
	fd.set('lokasi_absensi_id', fields.lokasi_absensi_id ?? 'lok-1');
	fd.set('liveness_passed', fields.liveness_passed ?? 'true');
	fd.set('foto', new File([new Uint8Array([10, 20, 30])], 'selfie.jpg', { type: 'image/jpeg' }));

	const request = new Request('http://localhost:9390/api/ess/attendance/clock-in', {
		method: 'POST',
		headers: { 'user-agent': 'Vitest-UA' },
		body: fd
	});

	return {
		request,
		getClientAddress: () => '127.0.0.1'
	} as any;
}

describe('ESS attendance clock-in & clock-out performance & lock safety', () => {
	beforeEach(() => {
		mockDirectusJson.mockReset();
		mockDirectusUpload.mockReset();
		mockAuthenticateEss.mockReset();
		mockFindActiveCheckin.mockReset();
		clearLokasiCache();
		clearFaceVerifyCache();
		clearPhoneDepositSettingsCache();
		clearIstirahatCache();
		invalidateFieldGateEnforcementCache();

		mockAuthenticateEss.mockResolvedValue({
			karyawan: { id: 101, nama_karyawan: 'Budi', divisi: 'IT' }
		});
		mockFindActiveCheckin.mockResolvedValue(null);
	});

	it('clock-in coalesces concurrent duplicate taps via lock (1x upload, 1x POST, 0 face_verification_log)', async () => {
		let createdRows = 0;
		mockDirectusUpload.mockImplementation(
			() =>
				new Promise((resolve) =>
					setTimeout(() => resolve(new Response(JSON.stringify({ data: { id: 'file-masuk-1' } }), { status: 200 })), 15)
				)
		);

		mockDirectusJson.mockImplementation(async (path: string, init?: RequestInit) => {
			if (path.startsWith('/items/absensi_harian?') && path.includes('filter%5Btanggal%5D%5B_eq%5D')) {
				return { data: [] };
			}
			if (path.startsWith('/items/absensi_harian?') && path.includes('filter%5Btanggal%5D%5B_lt%5D')) {
				return { data: [] };
			}
			if (path.startsWith('/items/app_settings')) {
				return { data: [{ key: 'phone_deposit.mode_gerbang', value: 'off' }] };
			}
			if (path.startsWith('/items/lokasi_absensi')) {
				return {
					data: [{ id: 'lok-1', nama: 'Kantor Pusat', lat: -6.2, lng: 106.8, radius_m: 200, aktif: true, face_match_threshold: null }]
				};
			}
			if (path.startsWith('/items/karyawan_face_data')) {
				return { data: [] };
			}
			if (path === '/items/absensi_harian' && init?.method === 'POST') {
				createdRows += 1;
				const body = JSON.parse(String(init.body));
				return { data: { id: 'abs-new-1', ...body } };
			}
			if (path.startsWith('/items/face_verification_log')) {
				throw new Error('face_verification_log must NOT be called when no enrollment exists');
			}
			throw new Error(`Unexpected Directus call: ${path}`);
		});

		// Simulasi 2 request klik ganda paralel dari karyawan yang sama.
		const [res1, res2] = await Promise.all([
			clockInPOST(buildAttendanceEvent()),
			clockInPOST(buildAttendanceEvent())
		]);

		expect(res1.status).toBe(200);
		expect(res2.status).toBe(200);
		const body1 = await res1.json();
		const body2 = await res2.json();
		expect(body1.record.id).toBe('abs-new-1');
		expect(body2.record.id).toBe('abs-new-1');
		expect(body1.record.foto_selfie).toBe('file-masuk-1');
		expect(body1.record.face_verify_masuk_id).toBeNull();

		// Tepat 1x upload foto dan 1x POST absensi_harian.
		expect(mockDirectusUpload).toHaveBeenCalledTimes(1);
		expect(createdRows).toBe(1);

		// Tunggu microtask background verifyFace selesai dan pastikan tidak menulis face_verification_log.
		await new Promise((r) => setTimeout(r, 10));
		const faceLogCalls = mockDirectusJson.mock.calls.filter(([p]) => String(p).startsWith('/items/face_verification_log'));
		expect(faceLogCalls).toHaveLength(0);
	});

	it('clock-out skips disabled guards, uploads 1x, coalesces concurrent taps, and skips face log when unenrolled', async () => {
		let patchCount = 0;
		mockDirectusUpload.mockImplementation(
			() =>
				new Promise((resolve) =>
					setTimeout(() => resolve(new Response(JSON.stringify({ data: { id: 'file-pulang-1' } }), { status: 200 })), 15)
				)
		);

		mockDirectusJson.mockImplementation(async (path: string, init?: RequestInit) => {
			if (path.startsWith('/items/absensi_harian?')) {
				return {
					data: [
						{
							id: 'abs-today-1',
							karyawan_id: '101',
							tanggal: '2026-11-24',
							status: 'HADIR',
							jam_masuk: '08:00',
							jam_keluar: '-',
							lat_masuk: -6.2,
							lng_masuk: 106.8,
							lokasi_absensi_id: 'lok-1'
						}
					]
				};
			}
			if (path.startsWith('/items/konfigurasi_kebijakan_disiplin')) {
				return {
					data: [
						{
							id: 1,
							tahun_berlaku: 2026,
							status: 'aktif',
							istirahat_absen_mandiri_aktif: true,
							istirahat_blokir_pulang: false
						}
					]
				};
			}
			if (path.startsWith('/items/istirahat_kategori')) {
				return { data: [] };
			}
			if (path.startsWith('/items/gate_enforcement')) {
				return {
					data: [
						{ gate_key: 'G_ESS_CLOCKOUT_COMPLETE', mode: 'hard', enforce_from: null },
						{ gate_key: 'G_ESS_VISIT_PLAN_VS_ACTUAL', mode: 'shadow', enforce_from: null }
					]
				};
			}
			if (path.startsWith('/items/lokasi_absensi')) {
				return {
					data: [{ id: 'lok-1', nama: 'Kantor Pusat', lat: -6.2, lng: 106.8, radius_m: 200, aktif: true, face_match_threshold: null }]
				};
			}
			if (path.startsWith('/items/karyawan_face_data')) {
				return { data: [] };
			}
			if (path === '/items/absensi_harian/abs-today-1' && init?.method === 'PATCH') {
				patchCount += 1;
				const body = JSON.parse(String(init.body));
				return { data: { id: 'abs-today-1', ...body } };
			}
			if (path.startsWith('/items/absensi_istirahat_log') || path.startsWith('/items/site_checkin')) {
				throw new Error(`Guard query should have been skipped: ${path}`);
			}
			throw new Error(`Unexpected Directus call: ${path}`);
		});

		const [res1, res2] = await Promise.all([
			clockOutPOST(buildAttendanceEvent()),
			clockOutPOST(buildAttendanceEvent())
		]);

		expect(res1.status).toBe(200);
		expect(res2.status).toBe(200);
		const body1 = await res1.json();
		expect(body1.record.foto_pulang).toBe('file-pulang-1');
		expect(body1.record.face_verify_keluar_id).toBeNull();
		expect(mockDirectusUpload).toHaveBeenCalledTimes(1);
		expect(patchCount).toBe(1);
		expect(mockFindActiveCheckin).toHaveBeenCalledTimes(1);

		await new Promise((r) => setTimeout(r, 10));
		const faceLogCalls = mockDirectusJson.mock.calls.filter(([p]) => String(p).startsWith('/items/face_verification_log'));
		expect(faceLogCalls).toHaveLength(0);
	});
});

