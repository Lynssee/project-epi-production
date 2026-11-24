import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { FIREBASE_API_KEY: 'test-firebase-key' }
}));

const { verifyFirebaseToken, clearFirebaseVerifyCache } = await import('./firebaseAuth');

function makeJwt(payload: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
	const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `${header}.${body}.sig`;
}

beforeEach(() => {
	clearFirebaseVerifyCache();
	vi.restoreAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('verifyFirebaseToken (coalescing, timeout fallback, rejection)', () => {
	it('menggabungkan panggilan paralel dengan token identik menjadi 1 fetch ke Identity Toolkit', async () => {
		let resolveFetch!: (res: Response) => void;
		const fetchMock = vi.fn(
			() =>
				new Promise<Response>((res) => {
					resolveFetch = res;
				})
		);
		vi.stubGlobal('fetch', fetchMock);

		const token = makeJwt({ user_id: 'uid-1', email: 'a@eltama.com', exp: Math.floor(Date.now() / 1000) + 3600 });
		const p1 = verifyFirebaseToken(token);
		const p2 = verifyFirebaseToken(token);
		const p3 = verifyFirebaseToken(token);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		resolveFetch(
			new Response(JSON.stringify({ users: [{ localId: 'uid-1', email: 'a@eltama.com' }] }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);

		const [u1, u2, u3] = await Promise.all([p1, p2, p3]);
		expect(u1?.localId).toBe('uid-1');
		expect(u2?.localId).toBe('uid-1');
		expect(u3?.localId).toBe('uid-1');

		// Panggilan berikutnya langsung dari cache
		const u4 = await verifyFirebaseToken(token);
		expect(u4?.localId).toBe('uid-1');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('fallback ke decode JWT lokal saat Identity Toolkit timeout atau 503', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const timeoutErr = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutErr));

		const token = makeJwt({ user_id: 'uid-fallback', email: 'lapangan@eltama.com', exp: Math.floor(Date.now() / 1000) + 3600 });
		const user = await verifyFirebaseToken(token);
		expect(user?.localId).toBe('uid-fallback');
		expect(user?.email).toBe('lapangan@eltama.com');

		errSpy.mockRestore();
		warnSpy.mockRestore();
	});

	it('menolak tegas (null) saat Identity Toolkit mengembalikan 400/401', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'INVALID_ID_TOKEN' } }), { status: 400 }))
		);
		const token = makeJwt({ user_id: 'uid-bad', email: 'x@eltama.com', exp: Math.floor(Date.now() / 1000) + 3600 });
		expect(await verifyFirebaseToken(token)).toBeNull();
	});
});

