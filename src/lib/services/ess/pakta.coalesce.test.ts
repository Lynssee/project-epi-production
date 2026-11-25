import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/firebase', () => ({
	auth: {
		currentUser: {
			uid: 'u-pakta',
			getIdToken: vi.fn().mockResolvedValue('tok-pakta')
		}
	}
}));

const { getPaktaSaya, getPaktaStatus, invalidatePaktaCache } = await import('./pakta');

describe('pakta client in-flight coalescing', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		invalidatePaktaCache();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('coalesces parallel getPaktaSaya() calls (sidebar + header mounts = 1 fetch)', async () => {
		let resolveFetch!: (res: Response) => void;
		const fetchMock = vi.fn(
			() =>
				new Promise<Response>((res) => {
					resolveFetch = res;
				})
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const p1 = getPaktaSaya();
		const p2 = getPaktaSaya();
		await Promise.resolve();
		await Promise.resolve();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		resolveFetch(new Response(JSON.stringify({ enabled: true, count: 1, prosedur: [], gate: [] }), { status: 200 }));
		const [r1, r2] = await Promise.all([p1, p2]);
		expect(r1.count).toBe(1);
		expect(r2.count).toBe(1);
	});

	it('coalesces parallel getPaktaStatus() calls for the same path', async () => {
		let resolveFetch!: (res: Response) => void;
		const fetchMock = vi.fn(
			() =>
				new Promise<Response>((res) => {
					resolveFetch = res;
				})
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const p1 = getPaktaStatus('/ess');
		const p2 = getPaktaStatus('/ess');
		await Promise.resolve();
		await Promise.resolve();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		resolveFetch(
			new Response(
				JSON.stringify({
					enabled: true,
					decision: { show: false, presentation: 'none', blocked: false, canProceedWithNote: false },
					items: []
				}),
				{ status: 200 }
			)
		);
		const [r1, r2] = await Promise.all([p1, p2]);
		expect(r1.enabled).toBe(true);
		expect(r2.enabled).toBe(true);
	});
});

