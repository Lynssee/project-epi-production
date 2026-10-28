import { describe, it, expect, vi } from 'vitest';
import { WAITING_STATUSES, balanceLevel, fetchWithTimeout, RequestTimeoutError, buildTimeline } from './pettyCashUx';

describe('U6 — WAITING_STATUSES memuat Finance', () => {
	it('tiga tahap menunggu', () => expect([...WAITING_STATUSES]).toEqual(['menunggu_atasan', 'menunggu_finance', 'menunggu_kasir']));
});

describe('U8 — balanceLevel (saldo mentah tidak dikirim ke pemohon)', () => {
	it('habis / rendah / cukup', () => {
		expect(balanceLevel(0, 5000000)).toBe('habis');
		expect(balanceLevel(-100, 5000000)).toBe('habis');
		expect(balanceLevel(1000000, 5000000)).toBe('rendah'); // < 30% × 5 jt = 1,5 jt
		expect(balanceLevel(1500000, 5000000)).toBe('cukup'); // tepat di ambang → cukup
		expect(balanceLevel(4000000, 5000000)).toBe('cukup');
	});
	it('ambang dari replenish_threshold_pct; kosong/nol/tak valid → 30%', () => {
		expect(balanceLevel(2000000, 5000000, 50)).toBe('rendah');
		expect(balanceLevel(2000000, 5000000, null)).toBe('cukup');
		expect(balanceLevel(1000000, 5000000, 0)).toBe('rendah');
		expect(balanceLevel(1000000, 5000000, 'x')).toBe('rendah');
	});
	it('tanpa limit / saldo tak valid → cukup (tak menakut-nakuti tanpa dasar)', () => {
		expect(balanceLevel(10, 0)).toBe('cukup');
		expect(balanceLevel(10, null)).toBe('cukup');
		expect(balanceLevel('abc', 5000000)).toBe('cukup');
		expect(balanceLevel(null, 5000000)).toBe('cukup');
	});
	it('string numerik (Directus decimal) dihitung', () => {
		expect(balanceLevel('1000000.00', '5000000.00')).toBe('rendah');
	});
});

describe('U3 — fetchWithTimeout', () => {
	it('respons normal diteruskan', async () => {
		const f = vi.fn(async () => new Response('ok')) as any;
		const r = await fetchWithTimeout(f, '/x', {}, 1000);
		expect(await r.text()).toBe('ok');
		expect(f.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
	});
	it('fetch menggantung → RequestTimeoutError dengan pesan ramah', async () => {
		const hang = ((_u: string, init: any) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))))) as any;
		const p = fetchWithTimeout(hang, '/x', {}, 20);
		await expect(p).rejects.toBeInstanceOf(RequestTimeoutError);
		await expect(fetchWithTimeout(hang, '/x', {}, 20)).rejects.toThrow(/draf Anda aman.*Cek riwayat/);
	});
	it('error jaringan lain tidak diubah', async () => {
		const f = (async () => { throw new TypeError('Failed to fetch'); }) as any;
		await expect(fetchWithTimeout(f, '/x', {}, 100)).rejects.toThrow('Failed to fetch');
	});
});

describe('U7 — buildTimeline', () => {
	it('label ramah, pelaku, catatan; event tak dikenal tetap tampil', () => {
		const t = buildTimeline([
			{ event: 'created', actor_name: 'Budi', date_created: '2026-09-29T03:00:00Z' },
			{ event: 'atasan_approved', actor_name: 'Sari', date_created: '2026-09-29T03:12:00Z', note: 'ok' },
			{ event: 'aneh', actor: 'system' }
		]);
		expect(t[0]).toEqual({ label: 'Dibuat', who: 'Budi', when: '2026-09-29T03:00:00Z', note: null });
		expect(t[1]).toMatchObject({ label: 'Disetujui atasan', who: 'Sari', note: 'ok' });
		expect(t[2]).toMatchObject({ label: 'aneh', who: null });
		expect(buildTimeline(null)).toEqual([]);
	});
});
