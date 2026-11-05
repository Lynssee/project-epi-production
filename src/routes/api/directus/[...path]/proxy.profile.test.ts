// Integrasi proxy Directus lapangan (Fase 1 monitoring fetch): coalescing GET identik, Server-Timing,
// X-Epi-Bytes, read-your-writes setelah tulis, dan pencatatan ke profiler. Auth & Directus di-mock.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/firebaseAuth', () => ({ requireUser: vi.fn(async () => ({ localId: 'u1', email: 'a@b.c' })) }));

let upstreamCalls: string[] = [];
let release: (() => void) | null = null;
vi.mock('$lib/server/directus', () => ({
	directusServerFetch: vi.fn(async (endpoint: string, opts: any = {}) => {
		upstreamCalls.push(`${opts?.method || 'GET'} ${endpoint}`);
		if (!opts?.method || opts.method === 'GET') await new Promise<void>((r) => (release ? (release = ((prev) => () => (prev?.(), r()))(release)) : (release = r)));
		return new Response('{"data":[{"id":1}]}', { status: 200, headers: { 'content-type': 'application/json' } });
	}),
	directusServerUpload: vi.fn(),
	directusServerJson: vi.fn(async () => ({ data: [] }))
}));

import { GET, PATCH } from './+server';
import { getDirectusProfile, resetDirectusProfile } from '../../health/pulse/directusLatencyTracker';

const ev = (path: string, method = 'GET', search = '', headers: Record<string, string> = {}) =>
	({
		params: { path },
		url: new URL(`http://x/api/directus/${path}${search}`),
		request: new Request(`http://x/api/directus/${path}${search}`, {
			method,
			headers: { referer: 'http://x/project/42/laporan', authorization: 'Bearer t', ...headers },
			body: method === 'GET' ? undefined : '{"a":1}'
		})
	}) as any;

const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
	upstreamCalls = [];
	release = null;
	resetDirectusProfile();
});

describe('proxy lapangan — coalescing & profiler', () => {
	it('5 GET identik serentak = 1 panggilan Directus; 4 bertanda COALESCED, ukuran & Server-Timing terisi', async () => {
		const all = Array.from({ length: 5 }, () => GET(ev('items/employees', 'GET', '?limit=5&fields=*')));
		await flush();
		release?.();
		const res = await Promise.all(all);

		expect(upstreamCalls).toEqual(['GET /items/employees?limit=5&fields=*']);
		const timings = res.map((r) => r.headers.get('Server-Timing') || '');
		expect(timings.filter((t) => t.includes('desc="COALESCED"'))).toHaveLength(4);
		expect(timings.filter((t) => t.includes('desc="MISS"'))).toHaveLength(1);
		expect(timings.every((t) => /app;dur=\d+/.test(t))).toBe(true);
		for (const r of res) {
			expect(await r.text()).toBe('{"data":[{"id":1}]}');
			expect(r.headers.get('X-Epi-Bytes')).toBe(String('{"data":[{"id":1}]}'.length));
		}

		const p = getDirectusProfile();
		expect(p.totals).toMatchObject({ calls: 5, miss: 1, coalesced: 4 });
		expect(p.totals.cacheHitPct).toBe(80);
		const coll = p.collections.find((c) => c.name === 'employees')!;
		expect(coll).toMatchObject({ calls: 5, upstreamCalls: 1, wildcardFields: 5 });
		expect(p.routes[0].name).toBe('/project/:id/laporan');
	});

	it('x-directus-no-cache = tidak digabung (tiap request ke Directus)', async () => {
		const all = [1, 2].map(() => GET(ev('items/employees', 'GET', '?limit=1', { 'x-directus-no-cache': '1' })));
		await flush();
		release?.();
		await Promise.all(all);
		expect(upstreamCalls).toHaveLength(2);
	});

	it('GET sesudah PATCH koleksi yang sama tidak menumpang GET lama (read-your-writes)', async () => {
		const before = GET(ev('items/employees', 'GET', '?limit=5'));
		await flush();
		const write = PATCH(ev('items/employees/9', 'PATCH'));
		await flush();
		const after = GET(ev('items/employees', 'GET', '?limit=5'));
		await flush();
		release?.();
		await Promise.all([before, write, after]);
		expect(upstreamCalls.filter((c) => c.startsWith('GET'))).toHaveLength(2);
		expect(getDirectusProfile().totals.bypass).toBe(1);
	});

	it('koleksi berbeda tidak digabung', async () => {
		const all = [GET(ev('items/employees', 'GET', '?limit=5')), GET(ev('items/projects', 'GET', '?limit=5'))];
		await flush();
		release?.();
		await Promise.all(all);
		expect(upstreamCalls).toHaveLength(2);
	});
});
