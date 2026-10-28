import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultTimeoutMs, fetchWithTimeout, isNetworkError } from './fetchTimeout';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('defaultTimeoutMs', () => {
	it('GET 30 dtk, tulis 60 dtk', () => {
		expect(defaultTimeoutMs()).toBe(30_000);
		expect(defaultTimeoutMs('get')).toBe(30_000);
		expect(defaultTimeoutMs('POST')).toBe(60_000);
		expect(defaultTimeoutMs('PATCH')).toBe(60_000);
	});
});

describe('fetchWithTimeout', () => {
	it('meneruskan respons HTTP apa adanya (server menolak ≠ error jaringan)', async () => {
		const res = new Response('{}', { status: 400 });
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));
		await expect(fetchWithTimeout('/x')).resolves.toBe(res);
	});

	it('timeout → error isNetwork + isTimeout dengan pesan koneksi lambat', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' })));
		const err = await fetchWithTimeout('/x').catch((e) => e);
		expect(isNetworkError(err)).toBe(true);
		expect(err.isTimeout).toBe(true);
		expect(err.message).toMatch(/lambat/i);
	});

	it('jaringan putus → error isNetwork tanpa isTimeout', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
		const err = await fetchWithTimeout('/x').catch((e) => e);
		expect(isNetworkError(err)).toBe(true);
		expect(err.isTimeout).toBeUndefined();
		expect(err.message).toMatch(/koneksi internet/i);
	});

	it('error biasa bukan isNetwork', () => {
		expect(isNetworkError(new Error('x'))).toBe(false);
		expect(isNetworkError(null)).toBe(false);
	});
});
