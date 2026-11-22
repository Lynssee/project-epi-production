import { describe, it, expect, vi, beforeEach } from 'vitest';

let baseUrl: string | undefined = 'https://admin.test';
vi.mock('$env/dynamic/private', () => ({ env: new Proxy({}, { get: (_t, k) => (k === 'ERP_EPI1_BASE_URL' ? baseUrl : undefined) }) }));
vi.mock('$lib/server/firebaseAuth', () => ({ requireUser: vi.fn().mockResolvedValue({ uid: 'u1' }) }));

import { GET, POST } from './+server';

const ev = (url: string, init: RequestInit = {}) =>
	({ request: new Request(url, { headers: { Authorization: 'Bearer tok' }, ...init }), url: new URL(url) }) as any;

describe('relay tes K3 manpower', () => {
	beforeEach(() => {
		baseUrl = 'https://admin.test';
		vi.unstubAllGlobals();
	});

	it('ERP_EPI1_BASE_URL kosong → 503 dengan pesan jelas', async () => {
		baseUrl = undefined;
		const res = await GET(ev('http://x/api/manpower-k3?ids=1'));
		expect(res.status).toBe(503);
		expect((await res.json()).ok).toBe(false);
	});

	it('GET: hanya digit/koma diteruskan, token Firebase ikut', async () => {
		const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: { konfigurasi: true, map: {} } }) });
		vi.stubGlobal('fetch', f);
		const res = await GET(ev('http://x/api/manpower-k3?ids=1,2,3;drop'));
		expect(res.status).toBe(200);
		expect(f.mock.calls[0][0]).toBe('https://admin.test/api/hrd/manpower-k3?ids=1,2,3');
		expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
		expect((await res.json()).data.konfigurasi).toBe(true);
	});

	it('GET tanpa ids → 400', async () => {
		expect((await GET(ev('http://x/api/manpower-k3'))).status).toBe(400);
	});

	it('POST: hanya manpower_id & kirim_wa yang diteruskan (field lain dibuang)', async () => {
		const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: { url: 'https://admin.test/tes/abc' } }) });
		vi.stubGlobal('fetch', f);
		const res = await POST(ev('http://x/api/manpower-k3', { method: 'POST', body: JSON.stringify({ manpower_id: '7', kirim_wa: true, quiz_id: 999, token: 'x' }) }));
		expect(res.status).toBe(200);
		expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ manpower_id: 7, kirim_wa: true });
	});

	it('pesan validasi admin diteruskan apa adanya (mis. kuis K3 belum diatur 409)', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ message: 'Kuis K3 manpower belum diatur.' }) }));
		const res = await POST(ev('http://x/api/manpower-k3', { method: 'POST', body: JSON.stringify({ manpower_id: 7 }) }));
		expect(res.status).toBe(409);
		expect((await res.json()).message).toBe('Kuis K3 manpower belum diatur.');
	});

	it('admin tak terjangkau → 503', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
		const res = await POST(ev('http://x/api/manpower-k3', { method: 'POST', body: JSON.stringify({ manpower_id: 7 }) }));
		expect(res.status).toBe(503);
	});
});
