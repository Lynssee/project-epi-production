import { describe, it, expect, vi } from 'vitest';
import { runWithRetry } from './paSnapshotRetry';

const noSleep = async () => {};

describe('runWithRetry', () => {
	it('berhasil percobaan pertama: tidak retry', async () => {
		const fn = vi.fn().mockResolvedValue('ok');
		const r = await runWithRetry(fn, { sleep: noSleep });
		expect(r).toMatchObject({ ok: true, attempts: 1, result: 'ok' });
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('gagal sekali lalu berhasil: retry menutup kegagalan sesaat', async () => {
		const fn = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce('ok');
		const sleep = vi.fn(noSleep);
		const r = await runWithRetry(fn, { sleep, delayMs: 1500 });
		expect(r).toMatchObject({ ok: true, attempts: 2 });
		expect(sleep).toHaveBeenCalledWith(1500);
	});

	it('gagal terus: tidak melempar, mengembalikan error terakhir & jumlah percobaan', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('admin 502'));
		const r = await runWithRetry(fn, { retries: 2, sleep: noSleep });
		expect(r.ok).toBe(false);
		expect(r.attempts).toBe(3);
		expect(r.error?.message).toBe('admin 502');
	});

	it('error non-Error dibungkus; retries negatif dianggap 0', async () => {
		const r = await runWithRetry(async () => { throw 'teks'; }, { retries: -3, sleep: noSleep });
		expect(r.ok).toBe(false);
		expect(r.attempts).toBe(1);
		expect(r.error).toBeInstanceOf(Error);
	});
});
