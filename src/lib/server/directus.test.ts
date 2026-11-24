import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		DIRECTUS_API_URL: 'https://directus.example.test',
		DIRECTUS_TOKEN: 'secret-token'
	}
}));

const { directusServerJson, directusServerFetch, directusServerUpload } = await import('./directus');

beforeEach(() => {
	vi.restoreAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('directusServerJson & timeout/retry safety', () => {
	it('TIDAK me-retry HTTP 502 untuk POST/PATCH (cegah duplikat baris absensi)', async () => {
		const fetchMock = vi.fn().mockImplementation(async () => new Response('Bad Gateway', { status: 502 }));
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			directusServerJson('/items/absensi_harian', { method: 'POST', body: JSON.stringify({ karyawan_id: '1' }) })
		).rejects.toThrow('Directus 502');
		expect(fetchMock).toHaveBeenCalledTimes(1);

		fetchMock.mockClear();
		await expect(
			directusServerJson('/items/absensi_harian/abc', { method: 'PATCH', body: JSON.stringify({ jam_keluar: '17:00' }) })
		).rejects.toThrow('Directus 502');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('tetap me-retry 1x untuk GET yang mendapat HTTP 502', async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 1 }] }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		const promise = directusServerJson('/items/lokasi_absensi');
		await vi.advanceTimersByTimeAsync(1600);
		const result = await promise;

		expect(result).toEqual({ data: [{ id: 1 }] });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('meneruskan AbortSignal timeout pada directusServerFetch dan directusServerUpload', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: null }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		await directusServerFetch('/items/test', { timeoutMs: 5000 });
		expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);

		await directusServerUpload(new FormData(), { timeoutMs: 12000 });
		expect(fetchMock.mock.calls[1][1]?.signal).toBeInstanceOf(AbortSignal);
	});

	it('mengubah TimeoutError menjadi pesan timeout yang jelas tanpa menyertakan query string', async () => {
		const timeoutErr = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutErr));

		await expect(
			directusServerJson('/items/absensi_harian?filter[karyawan_id][_eq]=371', { timeoutMs: 4000 })
		).rejects.toThrow('Directus timeout (4000ms) pada GET /items/absensi_harian');
	});
});

