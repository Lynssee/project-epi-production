import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadTrainingStatus, clearTrainingStatusMemo } from './processGuidanceTrainingApi';

const tok = async () => 't';
const res = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => body }) as any;
const ITEM = { id: 13, kode: 'KC-P1', judul: 'Sandblasting', terbit: true, self_enroll: true, status_saya: 'belum', progress: null, tenggat: null };
beforeEach(() => clearTrainingStatusMemo());

describe('loadTrainingStatus', () => {
	it('id dibersihkan/diurut/dibatasi, Bearer, memo 3 menit', async () => {
		const fetchImpl = vi.fn(async () => res({ success: true, source: 'directus', programs: [ITEM] }));
		const r = await loadTrainingStatus([14, 13, 13, 0, -1], { fetchImpl: fetchImpl as any, getToken: tok, now: 0 });
		expect(r).toEqual({ ok: true, items: [ITEM] });
		expect((fetchImpl.mock.calls[0] as any)[0]).toBe('/api/process-guidance/training?ids=13,14');
		expect((fetchImpl.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer t');
		await loadTrainingStatus([13, 14], { fetchImpl: fetchImpl as any, getToken: tok, now: 100000 });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		await loadTrainingStatus([13, 14], { fetchImpl: fetchImpl as any, getToken: tok, now: 200000 });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
	it('tanpa id valid → ok kosong tanpa panggilan', async () => {
		const fetchImpl = vi.fn();
		expect(await loadTrainingStatus([], { fetchImpl: fetchImpl as any, getToken: tok })).toEqual({ ok: true, items: [] });
		expect(await loadTrainingStatus([0, NaN as any], { fetchImpl: fetchImpl as any, getToken: tok })).toEqual({ ok: true, items: [] });
		expect(fetchImpl).not.toHaveBeenCalled();
	});
	it('permintaan sama yang bersamaan berbagi satu panggilan', async () => {
		let resolve: (v: any) => void = () => {};
		const fetchImpl = vi.fn(() => new Promise((r) => { resolve = r; }));
		const a = loadTrainingStatus([13], { fetchImpl: fetchImpl as any, getToken: tok });
		const b = loadTrainingStatus([13], { fetchImpl: fetchImpl as any, getToken: tok });
		await new Promise((r) => setTimeout(r, 0));
		resolve(res({ success: true, source: 'directus', programs: [ITEM] }));
		const [ra, rb] = await Promise.all([a, b]);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(ra).toBe(rb);
	});
	it('gagal (HTTP, fallback server, data rusak, token kosong, jaringan) → ok:false tanpa melempar & tidak di-memo', async () => {
		expect(await loadTrainingStatus([13], { fetchImpl: (async () => res({}, 500)) as any, getToken: tok })).toEqual({ ok: false, items: [] });
		expect((await loadTrainingStatus([13], { fetchImpl: (async () => res({ success: true, source: 'fallback', programs: [] })) as any, getToken: tok })).ok).toBe(false);
		expect((await loadTrainingStatus([13], { fetchImpl: (async () => res({ success: true, source: 'directus', programs: [{ x: 1 }] })) as any, getToken: tok })).ok).toBe(false);
		expect((await loadTrainingStatus([13], { fetchImpl: vi.fn() as any, getToken: async () => null })).ok).toBe(false);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect((await loadTrainingStatus([13], { fetchImpl: (async () => { throw new Error('offline'); }) as any, getToken: tok })).ok).toBe(false);
		warn.mockRestore();
		const ok = vi.fn(async () => res({ success: true, source: 'directus', programs: [ITEM] }));
		expect((await loadTrainingStatus([13], { fetchImpl: ok as any, getToken: tok })).ok).toBe(true); // pulih setelah kegagalan
	});
});
