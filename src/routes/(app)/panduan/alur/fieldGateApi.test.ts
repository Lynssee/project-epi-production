import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadGateInfo, clearGateInfoMemo, searchKendala } from './fieldGateApi';

const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;
const mem = () => {
	const m = new Map<string, string>();
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), _m: m };
};
const deps = (r: Response | Error, storage: ReturnType<typeof mem> | null = mem(), now = 1_000_000) => ({
	getToken: async () => 'tok',
	fetchImpl: (r instanceof Error ? vi.fn().mockRejectedValue(r) : vi.fn().mockResolvedValue(r)) as unknown as typeof fetch,
	storage,
	now
});

beforeEach(() => {
	clearGateInfoMemo();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('loadGateInfo', () => {
	it('memanggil ?gates= dengan token; sukses disimpan di memori & perangkat; panggilan ulang 0 request', async () => {
		const d = deps(res(200, { success: true, available: true, gates: { G1: { mode: 'hard' } } }));
		const r = await loadGateInfo('lh', d);
		expect(r).toEqual({ available: true, gates: { G1: { mode: 'hard' } } });
		expect((d.fetchImpl as any).mock.calls[0][0]).toBe('/api/process-guidance/flows?gates=lh');
		expect((d.fetchImpl as any).mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
		expect(d.storage!._m.has('epi_flow_gates_v1_lh')).toBe(true);
		await loadGateInfo('lh', d);
		expect(d.fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('memori kedaluwarsa (>5 menit) memuat ulang', async () => {
		const d = deps(res(200, { success: true, available: true, gates: {} }));
		await loadGateInfo('lh', d);
		await loadGateInfo('lh', { ...d, now: d.now + 6 * 60_000 });
		expect(d.fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('server gagal/offline → salinan terakhir di perangkat (stale); tanpa salinan → available:false (tidak melempar)', async () => {
		const storage = mem();
		await loadGateInfo('lh', deps(res(200, { success: true, available: true, gates: { G1: { mode: 'soft' } } }), storage));
		clearGateInfoMemo();
		expect(await loadGateInfo('lh', deps(new Error('offline'), storage))).toEqual({ available: true, gates: { G1: { mode: 'soft' } }, stale: true });
		clearGateInfoMemo();
		expect(await loadGateInfo('lain', deps(res(500, {}), storage))).toMatchObject({ available: false, reason: 'HTTP 500' });
	});

	it('admin tak terjangkau (available:false) memakai salinan bila ada; salinan >7 hari dibuang', async () => {
		const storage = mem();
		storage.setItem('epi_flow_gates_v1_lh', JSON.stringify({ at: 1_000_000 - 8 * 24 * 3600_000, gates: { G1: {} } }));
		const r = await loadGateInfo('lh', deps(res(200, { success: true, available: false, reason: 'admin 503' }), storage));
		expect(r).toEqual({ available: false, gates: {}, reason: 'admin 503' });
		storage.setItem('epi_flow_gates_v1_lh', JSON.stringify({ at: 1_000_000 - 3600_000, gates: { G1: {} } }));
		expect((await loadGateInfo('lh', deps(res(200, { success: true, available: false }), storage))).stale).toBe(true);
	});

	it('tanpa token → fallback; kegagalan tidak di-cache di memori; salinan rusak diabaikan', async () => {
		const noToken = { getToken: async () => null, fetchImpl: vi.fn() as unknown as typeof fetch, storage: mem(), now: 1 };
		expect((await loadGateInfo('lh', noToken)).available).toBe(false);
		expect(noToken.fetchImpl).not.toHaveBeenCalled();
		const bad = mem();
		bad.setItem('epi_flow_gates_v1_lh', '{bukan json');
		expect((await loadGateInfo('lh', deps(res(500, {}), bad))).available).toBe(false);
		const ok = deps(res(200, { success: true, available: true, gates: {} }), bad);
		expect((await loadGateInfo('lh', ok)).available).toBe(true);
	});
});

describe('searchKendala (klien)', () => {
	it('kueri <2 huruf tidak memanggil server; hasil diteruskan', async () => {
		const d = deps(res(200, { success: true, hits: [{ flow_id: 'a' }] }));
		expect(await searchKendala(' k ', d)).toEqual({ hits: [] });
		expect(d.fetchImpl).not.toHaveBeenCalled();
		expect(await searchKendala('kurva s', d)).toEqual({ hits: [{ flow_id: 'a' }] });
		expect((d.fetchImpl as any).mock.calls[0][0]).toBe('/api/process-guidance/flows?kendala=kurva%20s');
	});
	it('galat → pesan ramah; dibatalkan (AbortError) → diam', async () => {
		expect((await searchKendala('kurva', deps(res(500, {})))).error).toMatch(/gagal/i);
		expect((await searchKendala('kurva', deps(new Error('x')))).error).toMatch(/sinyal/i);
		const abort = Object.assign(new Error('a'), { name: 'AbortError' });
		expect(await searchKendala('kurva', deps(abort))).toEqual({ hits: [] });
	});
});
