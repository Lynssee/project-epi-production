import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockDirectusJson = vi.fn();
const mockDirectusUpload = vi.fn();

vi.mock('$env/dynamic/private', () => ({
	env: { FACE_SERVICE_URL: 'http://face-service.test' }
}));

vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...args: unknown[]) => mockDirectusJson(...args),
	directusServerUpload: (...args: unknown[]) => mockDirectusUpload(...args)
}));

const { verifyFace, verifyFaceInBackground, clearFaceVerifyCache, hasAnyActiveFaceEnrollment } = await import('./faceVerify');

function makeFoto() {
	return new File([new Uint8Array([1, 2, 3, 4])], 'selfie.jpg', { type: 'image/jpeg' });
}

describe('faceVerify (Opsi B: skip when unenrolled + reuse existingFotoId)', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		mockDirectusJson.mockReset();
		mockDirectusUpload.mockReset();
		clearFaceVerifyCache();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('skips upload and face_verification_log completely when karyawan_face_data is empty, and caches check', async () => {
		mockDirectusJson.mockResolvedValue({ data: [] });

		const r1 = await verifyFace({
			karyawanId: 10,
			foto: makeFoto(),
			context: 'clock_in',
			livenessPassed: true,
			ipAddress: '127.0.0.1',
			deviceInfo: 'test-ua',
			existingFotoId: 'foto-existing-1',
			lokasiThreshold: 0.6,
			skipWhenUnenrolled: true
		});

		expect(r1).toEqual({
			verificationId: null,
			passed: false,
			matchScore: null,
			livenessPassed: true
		});
		expect(mockDirectusJson).toHaveBeenCalledTimes(1);
		expect(mockDirectusJson.mock.calls[0][0]).toContain('/items/karyawan_face_data?filter[status][_eq]=active&fields=id&limit=1');
		expect(mockDirectusUpload).not.toHaveBeenCalled();

		// Panggilan kedua memakai cache 5 menit -> 0 call Directus tambahan.
		const r2 = await verifyFace({
			karyawanId: 20,
			foto: makeFoto(),
			context: 'clock_out',
			livenessPassed: false,
			ipAddress: '127.0.0.1',
			deviceInfo: 'test-ua',
			skipWhenUnenrolled: true
		});
		expect(r2.verificationId).toBeNull();
		expect(mockDirectusJson).toHaveBeenCalledTimes(1);
		expect(mockDirectusUpload).not.toHaveBeenCalled();
	});

	it('coalesces concurrent hasAnyActiveFaceEnrollment calls into 1 Directus request', async () => {
		mockDirectusJson.mockImplementation(
			() => new Promise((resolve) => setTimeout(() => resolve({ data: [] }), 10))
		);

		const results = await Promise.all([
			hasAnyActiveFaceEnrollment(),
			hasAnyActiveFaceEnrollment(),
			hasAnyActiveFaceEnrollment()
		]);
		expect(results).toEqual([false, false, false]);
		expect(mockDirectusJson).toHaveBeenCalledTimes(1);
	});

	it('when enrolled: reuses existingFotoId & lokasiThreshold with 0 duplicate uploads and 0 lokasi GETs', async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ match_score: 0.88, passed: true }), { status: 200 })
		);
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		mockDirectusJson.mockImplementation(async (path: string, init?: RequestInit) => {
			if (path.startsWith('/items/karyawan_face_data?filter[status][_eq]=active&fields=id&limit=1')) {
				return { data: [{ id: 'fd-1' }] };
			}
			if (path.startsWith('/items/karyawan_face_data?')) {
				return { data: [{ id: 'fd-1', face_embedding: [0.1, 0.2, 0.3], version: 1 }] };
			}
			if (path === '/items/face_verification_log' && init?.method === 'POST') {
				return { data: { id: 'fvl-99' } };
			}
			throw new Error(`Unexpected Directus call: ${path}`);
		});

		const res = await verifyFace({
			karyawanId: 10,
			foto: makeFoto(),
			context: 'clock_in',
			livenessPassed: true,
			ipAddress: '10.0.0.1',
			deviceInfo: 'ua',
			lokasiAbsensiId: 'lok-1',
			existingFotoId: 'foto-already-uploaded',
			lokasiThreshold: 0.75,
			skipWhenUnenrolled: true
		});

		expect(res).toEqual({
			verificationId: 'fvl-99',
			passed: true,
			matchScore: 0.88,
			livenessPassed: true
		});
		expect(mockDirectusUpload).not.toHaveBeenCalled();
		expect(mockFetch).toHaveBeenCalledTimes(1);

		const logCall = mockDirectusJson.mock.calls.find(([p]) => p === '/items/face_verification_log');
		expect(logCall).toBeTruthy();
		const logBody = JSON.parse(String(logCall?.[1]?.body));
		expect(logBody.foto_capture).toBe('foto-already-uploaded');
		expect(logBody.match_score).toBe(0.88);
	});

	it('skips unenrolled employee even when another employee has active enrollment', async () => {
		mockDirectusJson.mockImplementation(async (path: string) => {
			if (path.includes('limit=1')) return { data: [{ id: 'fd-other' }] };
			if (path.startsWith('/items/karyawan_face_data?')) return { data: [] };
			throw new Error(`Should not call: ${path}`);
		});

		const res = await verifyFace({
			karyawanId: 77,
			foto: makeFoto(),
			context: 'clock_in',
			livenessPassed: true,
			ipAddress: '10.0.0.2',
			deviceInfo: 'ua',
			existingFotoId: 'foto-77',
			skipWhenUnenrolled: true
		});

		expect(res.verificationId).toBeNull();
		expect(mockDirectusUpload).not.toHaveBeenCalled();
	});

	it('verifyFaceInBackground invokes onVerified callback when verificationId is created', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ match_score: 0.91, passed: true }), { status: 200 })
		) as unknown as typeof fetch;

		mockDirectusJson.mockImplementation(async (path: string, init?: RequestInit) => {
			if (path.includes('limit=1')) return { data: [{ id: 'fd-1' }] };
			if (path.startsWith('/items/karyawan_face_data?')) {
				return { data: [{ id: 'fd-1', face_embedding: [0.5], version: 1 }] };
			}
			if (path === '/items/face_verification_log' && init?.method === 'POST') {
				return { data: { id: 'fvl-bg-1' } };
			}
			return { data: {} };
		});

		const onVerified = vi.fn().mockResolvedValue(undefined);
		verifyFaceInBackground(
			{
				karyawanId: 10,
				foto: makeFoto(),
				context: 'clock_in',
				livenessPassed: true,
				ipAddress: '10.0.0.1',
				deviceInfo: 'ua',
				existingFotoId: 'foto-1',
				lokasiThreshold: 0.7
			},
			onVerified
		);

		await vi.waitFor(() => {
			expect(onVerified).toHaveBeenCalledWith('fvl-bg-1');
		});
	});
});

