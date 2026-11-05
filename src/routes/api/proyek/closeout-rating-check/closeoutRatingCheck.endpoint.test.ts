import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const envState = vi.hoisted(() => ({ ERP_EPI1_BASE_URL: 'https://erp.example/' as string | undefined }));
vi.mock('$env/dynamic/private', () => ({ env: envState }));
vi.mock('$lib/server/firebaseAuth', () => ({ requireUser: vi.fn(async () => ({ localId: 'u1' })) }));
import { GET } from './+server';

const ev = (qs: string) => ({ url: new URL(`http://x/api/proyek/closeout-rating-check${qs}`), request: new Request('http://x', { headers: { authorization: 'Bearer tok' } }) }) as any;
const fetchMock = vi.fn();

beforeEach(() => { envState.ERP_EPI1_BASE_URL = 'https://erp.example/'; fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe('proxy closeout-rating-check', () => {
	it('meneruskan token + gate + projectId ke admin dan mengembalikan hasil ringkas', async () => {
		fetchMock.mockResolvedValue({ ok: true, json: async () => ({ gate: 'G_MANPOWER_RATING_CLOSEOUT', mode: 'warn', status: 'failed', blocked: false, detail: { total: 4, missing: [1, 2] } }) });
		const body = await (await GET(ev('?projectId=7'))).json();
		expect(body).toMatchObject({ available: true, status: 'failed', mode: 'warn', blocked: false, detail: { total: 4, missing: [1, 2] } });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://erp.example/api/kpi/gate-check');
		expect(init.headers.Authorization).toBe('Bearer tok');
		expect(JSON.parse(init.body)).toEqual({ gate: 'G_MANPOWER_RATING_CLOSEOUT', projectId: 7 });
	});
	it('FAIL-SOFT: projectId tidak valid, env kosong, admin error, jaringan putus, status unknown => available:false (bukan 500)', async () => {
		expect((await (await GET(ev('?projectId=abc'))).json()).available).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
		envState.ERP_EPI1_BASE_URL = undefined;
		expect((await (await GET(ev('?projectId=7'))).json()).available).toBe(false);
		envState.ERP_EPI1_BASE_URL = 'https://erp.example';
		fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
		expect((await (await GET(ev('?projectId=7'))).json()).available).toBe(false);
		fetchMock.mockRejectedValue(new Error('offline'));
		expect((await (await GET(ev('?projectId=7'))).json()).available).toBe(false);
		fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'unknown', mode: 'shadow', blocked: false }) });
		expect((await (await GET(ev('?projectId=7'))).json()).available).toBe(false);
	});
});
