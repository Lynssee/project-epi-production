import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireUser = vi.fn();
const envMock: Record<string, string | undefined> = {};
vi.mock('$lib/server/firebaseAuth', () => ({ requireUser: (...a: unknown[]) => requireUser(...a) }));
vi.mock('$env/dynamic/private', () => ({ env: envMock }));

const { GET } = await import('./+server');
const ev = (qs = '', auth = 'Bearer tok') =>
	({ url: new URL('http://x.test/api/ess/kpi-dampak' + qs), request: new Request('http://x.test', { headers: { authorization: auth } }) }) as any;

beforeEach(() => {
	vi.restoreAllMocks();
	requireUser.mockReset();
	requireUser.mockResolvedValue({ uid: 'u1' });
	envMock.ERP_EPI1_BASE_URL = 'https://erp.test/';
});

describe('GET /api/ess/kpi-dampak (proxy ke admin)', () => {
	it('wajib login (requireUser dipanggil); token diteruskan apa adanya; hanya month valid yang diteruskan', async () => {
		const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ available: true, items: [] }), { status: 200 }));
		const res = await GET(ev('?month=2026-11&department=HRD&x=1'));
		expect(requireUser).toHaveBeenCalledTimes(1);
		expect(await res.json()).toMatchObject({ available: true });
		const [url, init] = f.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://erp.test/api/kpi/finance-impact/saya?month=2026-11'); // department & x TIDAK diteruskan
		expect((init.headers as any).Authorization).toBe('Bearer tok');
	});

	it('month tidak valid dibuang', async () => {
		const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"available":false}', { status: 200 }));
		await GET(ev('?month=2026-13'));
		expect((f.mock.calls[0] as [string])[0]).toBe('https://erp.test/api/kpi/finance-impact/saya?');
	});

	it('fail-soft: base URL kosong / admin non-200 / jaringan gagal → available:false, tidak pernah melempar', async () => {
		envMock.ERP_EPI1_BASE_URL = '';
		expect((await (await GET(ev())).json()).available).toBe(false);
		envMock.ERP_EPI1_BASE_URL = 'https://erp.test';
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('x', { status: 503 }));
		expect((await (await GET(ev())).json()).reason).toContain('503');
		vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('timeout'));
		expect((await (await GET(ev())).json()).available).toBe(false);
	});

	it('tanpa login → requireUser melempar → permintaan ditolak (tidak diteruskan ke admin)', async () => {
		requireUser.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
		const f = vi.spyOn(globalThis, 'fetch');
		await expect(GET(ev())).rejects.toThrow('unauthorized');
		expect(f).not.toHaveBeenCalled();
	});
});
