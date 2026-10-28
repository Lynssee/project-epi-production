// src/lib/services/processGuidanceFlowsApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadProcessFlows, clearProcessFlowsMemo } from './processGuidanceFlowsApi';
import { PROCESS_FLOWS } from '../data/processGuidance';

const tok = async () => 't';
const res = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => body }) as any;
const FLOW = { id: 'x', title: 'X', description: '', lanes: [{ key: 'a', label: 'A' }], nodes: [], edges: [], version: 2 };
const mem = () => {
	const m = new Map<string, string>();
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), _m: m };
};

beforeEach(() => clearProcessFlowsMemo());

describe('loadProcessFlows (lapangan)', () => {
	it('Directus sukses → alur server, Bearer, disimpan ke storage, di-memo 5 menit', async () => {
		const storage = mem();
		const fetchImpl = vi.fn(async () => res({ success: true, source: 'directus', flows: [FLOW] }));
		const a = await loadProcessFlows({ fetchImpl: fetchImpl as any, getToken: tok, storage, now: 0 });
		expect(a).toEqual({ flows: [FLOW], source: 'directus' });
		expect((fetchImpl.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer t');
		expect(JSON.parse(storage._m.get('epi_process_flows_v1')!).flows).toEqual([FLOW]);
		await loadProcessFlows({ fetchImpl: fetchImpl as any, getToken: tok, storage, now: 200000 });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		await loadProcessFlows({ fetchImpl: fetchImpl as any, getToken: tok, storage, now: 400000 });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('Directus sukses tapi kosong → tetap source directus (bukan fallback)', async () => {
		const r = await loadProcessFlows({ fetchImpl: vi.fn(async () => res({ success: true, source: 'directus', flows: [] })) as any, getToken: tok, storage: mem() });
		expect(r).toEqual({ flows: [], source: 'directus' });
	});

	it('gagal (jaringan/HTTP/server fallback/tanpa token) → salinan tersimpan bila ada; bila tidak → bawaan lokal', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const cases: Deps[] = [
			{ fetchImpl: (async () => { throw new Error('net'); }) as any, getToken: tok },
			{ fetchImpl: (async () => res({}, 500)) as any, getToken: tok },
			{ fetchImpl: (async () => res({ success: true, source: 'fallback', flows: [] })) as any, getToken: tok },
			{ fetchImpl: vi.fn() as any, getToken: async () => null }
		] as any;
		for (const c of cases) {
			clearProcessFlowsMemo();
			const kosong = await loadProcessFlows({ ...c, storage: mem() });
			expect(kosong.source).toBe('local');
			expect(kosong.flows).toBe(PROCESS_FLOWS);
			clearProcessFlowsMemo();
			const s = mem();
			s.setItem('epi_process_flows_v1', JSON.stringify({ at: 1, flows: [FLOW] }));
			const cached = await loadProcessFlows({ ...c, storage: s });
			expect(cached).toMatchObject({ source: 'cached', flows: [FLOW] });
		}
		warn.mockRestore();
	});

	it('storage rusak / data tidak valid → diabaikan (bawaan lokal); gagal tulis storage tidak mengganggu', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const bad = mem();
		bad.setItem('epi_process_flows_v1', '{bukan json');
		const r1 = await loadProcessFlows({ fetchImpl: (async () => res({}, 500)) as any, getToken: tok, storage: bad });
		expect(r1.source).toBe('local');
		clearProcessFlowsMemo();
		bad.setItem('epi_process_flows_v1', JSON.stringify({ flows: [{ id: 1 }] }));
		expect((await loadProcessFlows({ fetchImpl: (async () => res({}, 500)) as any, getToken: tok, storage: bad })).source).toBe('local');
		clearProcessFlowsMemo();
		const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
		const ok = await loadProcessFlows({ fetchImpl: (async () => res({ success: true, source: 'directus', flows: [FLOW] })) as any, getToken: tok, storage: full as any });
		expect(ok.source).toBe('directus');
		warn.mockRestore();
	});

	it('badan respons aneh (flows bukan alur valid) → fallback', async () => {
		const r = await loadProcessFlows({ fetchImpl: (async () => res({ success: true, source: 'directus', flows: [{ id: 'x' }] })) as any, getToken: tok, storage: mem() });
		expect(r.source).toBe('local');
	});
});

type Deps = Parameters<typeof loadProcessFlows>[0];
