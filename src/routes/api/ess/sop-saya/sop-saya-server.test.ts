import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { ERP_EPI1_BASE_URL: 'https://admin.example.com/' } }));
vi.mock('$lib/server/firebaseAuth', () => ({ requireUser: vi.fn(async () => ({ uid: 'u' })) }));
import { GET } from './+server';
import { env } from '$env/dynamic/private';

const fetchMock = vi.fn();
const ev = (auth = 'Bearer abc') => ({ request: new Request('http://x', { headers: { authorization: auth } }) }) as any;

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
	(env as any).ERP_EPI1_BASE_URL = 'https://admin.example.com/';
});

describe('GET /api/ess/sop-saya (proxy ke erp-epi)', () => {
	it('meneruskan token apa adanya ke /api/ess/sop-saya dan mengembalikan hasilnya', async () => {
		fetchMock.mockResolvedValue({ ok: true, json: async () => ({ available: true, terhubung: true }) });
		const j = await (await GET(ev())).json();
		expect(fetchMock.mock.calls[0][0]).toBe('https://admin.example.com/api/ess/sop-saya');
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer abc');
		expect(j).toEqual({ available: true, terhubung: true });
	});
	it('base URL kosong, admin error, atau jaringan putus: available:false, tidak pernah 500', async () => {
		(env as any).ERP_EPI1_BASE_URL = '';
		expect((await (await GET(ev())).json()).available).toBe(false);
		(env as any).ERP_EPI1_BASE_URL = 'https://admin.example.com';
		fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
		expect((await GET(ev())).status).toBe(200);
		fetchMock.mockRejectedValue(new Error('timeout'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const r = await GET(ev());
		expect(r.status).toBe(200);
		expect((await r.json()).available).toBe(false);
		warn.mockRestore();
	});
});
