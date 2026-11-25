import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockWatermarkPhoto = vi.fn();
const mockCompressPhoto = vi.fn();
const mockGetIdToken = vi.fn();

vi.mock('$lib/firebase', () => ({
	auth: {
		currentUser: {
			uid: 'u-1',
			getIdToken: (...args: unknown[]) => mockGetIdToken(...args)
		}
	}
}));

vi.mock('$lib/utils/photoWatermark', () => ({
	watermarkPhoto: (...args: unknown[]) => mockWatermarkPhoto(...args)
}));

vi.mock('$lib/utils/photoCompress', () => ({
	compressPhoto: (...args: unknown[]) => mockCompressPhoto(...args)
}));

const { clockIn, clockOut, getTodayStatus, clearTodayStatusClientCache, AttendanceRequestError } = await import('./attendance');

function makeFoto(name = 'selfie.jpg') {
	return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });
}

describe('ess/attendance client service (Phase 3)', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		clearTodayStatusClientCache();
		mockWatermarkPhoto.mockReset();
		mockCompressPhoto.mockReset();
		mockGetIdToken.mockReset();
		mockGetIdToken.mockResolvedValue('tok-123');
		mockWatermarkPhoto.mockImplementation(async (f: File) => f);
		mockCompressPhoto.mockImplementation(async (f: File) => f);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('skips watermarkPhoto when skipWatermark=true and emits photo -> upload stages', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ record: { id: 'abs-1' } }), { status: 200 })
		) as unknown as typeof fetch;

		const stages: string[] = [];
		const res = await clockIn({
			lat: -6.2,
			lng: 106.8,
			accuracy: 10,
			photoFile: makeFoto(),
			livenessPassed: false,
			skipWatermark: true,
			onStage: (s) => stages.push(s)
		});

		expect(res.record.id).toBe('abs-1');
		expect(mockWatermarkPhoto).not.toHaveBeenCalled();
		expect(mockCompressPhoto).toHaveBeenCalledTimes(1);
		expect(stages).toEqual(['photo', 'upload']);
	});

	it('still calls watermarkPhoto when skipWatermark is omitted (backward compatible)', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ record: { id: 'abs-2' } }), { status: 200 })
		) as unknown as typeof fetch;

		await clockOut({
			lat: -6.2,
			lng: 106.8,
			photoFile: makeFoto()
		});

		expect(mockWatermarkPhoto).toHaveBeenCalledTimes(1);
		expect(mockWatermarkPhoto.mock.calls[0][3]).toEqual({ ringan: true });
		expect(mockCompressPhoto).toHaveBeenCalledTimes(1);
	});

	it('caches & coalesces getTodayStatus for 20s and invalidates on punch or force', async () => {
		const fetchMock = vi.fn().mockImplementation(async () =>
			new Response(JSON.stringify({ record: null, lokasiOptions: [], tanggal: '2026-11-25', istirahat: { aktif: false, kategoriAktif: [], konfig: null, jendela: null, jedaTerbuka: null, jedaHariIni: [] } }), { status: 200 })
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const [s1, s2] = await Promise.all([getTodayStatus(), getTodayStatus()]);
		expect(s1.tanggal).toBe('2026-11-25');
		expect(s2.tanggal).toBe('2026-11-25');
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// Hit cache 20s -> 0 fetch tambahan
		await getTodayStatus();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// force: true -> fetch segar
		await getTodayStatus({ force: true });
		expect(fetchMock).toHaveBeenCalledTimes(2);

		// clockIn berhasil -> invalidasi cache status
		await clockIn({ lat: -6.2, lng: 106.8, photoFile: makeFoto(), skipWatermark: true });
		await getTodayStatus();
		expect(fetchMock).toHaveBeenCalledTimes(4); // 2 status + 1 clockIn + 1 status segar
	});

	it('does NOT double-retry getTodayStatus on client timeout (prevents 31s hang)', async () => {
		const abortErr = new Error('The operation was aborted.');
		abortErr.name = 'AbortError';
		const fetchMock = vi.fn().mockRejectedValue(abortErr);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await expect(getTodayStatus()).rejects.toMatchObject({ code: 'ATTENDANCE_TIMEOUT' });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('throws AttendanceRequestError with status on 502/504 gateway errors', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response('Bad Gateway', { status: 502 })
		) as unknown as typeof fetch;

		try {
			await clockIn({
				lat: -6.2,
				lng: 106.8,
				photoFile: makeFoto(),
				skipWatermark: true
			});
			expect.unreachable('should throw');
		} catch (err) {
			expect(err).toBeInstanceOf(AttendanceRequestError);
			expect((err as InstanceType<typeof AttendanceRequestError>).status).toBe(502);
			expect((err as InstanceType<typeof AttendanceRequestError>).code).toBe('HTTP_ERROR');
		}
	});

	it('throws AttendanceRequestError with ATTENDANCE_TIMEOUT on AbortError', async () => {
		const abortErr = new Error('The operation was aborted.');
		abortErr.name = 'AbortError';
		globalThis.fetch = vi.fn().mockRejectedValue(abortErr) as unknown as typeof fetch;

		try {
			await clockIn({
				lat: -6.2,
				lng: 106.8,
				photoFile: makeFoto(),
				skipWatermark: true
			});
			expect.unreachable('should throw');
		} catch (err) {
			expect(err).toBeInstanceOf(AttendanceRequestError);
			expect((err as InstanceType<typeof AttendanceRequestError>).code).toBe('ATTENDANCE_TIMEOUT');
		}
	});
});

