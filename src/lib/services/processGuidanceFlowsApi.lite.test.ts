// src/lib/services/processGuidanceFlowsApi.lite.test.ts — daftar ringkas & satu alur (hemat kuota)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFlowIndex, loadFlowById, clearFlowLiteMemo } from './processGuidanceFlowsApi';
import { PROCESS_FLOWS } from '../data/processGuidance';

const tok = async () => 't';
const res = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => body }) as any;
const SUM = { id: 'x', title: 'X', description: '', version: 1, node_count: 2 };
const FLOW = { id: 'x', title: 'X', description: '', lanes: [{ key: 'a', label: 'A' }], nodes: [], edges: [], version: 2 };
const mem = () => {
	const m = new Map<string, string>();
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), _m: m };
};

beforeEach(() => clearFlowLiteMemo());

describe('loadFlowIndex', () => {
	it('memanggil ?lite=1 dengan Bearer, menyimpan salinan, memo 5 menit', async () => {
		const storage = mem();
		const fetchImpl = vi.fn(async () => res({ success: true, source: 'directus', flows: [SUM] }));
		const a = await loadFlowIndex({ fetchImpl: fetchImpl as any, getToken: tok, storage, now: 0 });
		expect(a).toEqual({ flows: [SUM], source: 'directus' });
		expect((fetchImpl.mock.calls[0] as any)[0]).toBe('/api/process-guidance/flows?lite=1');
		expect((fetchImpl.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer t');
		expect(JSON.parse(storage._m.get('epi_process_flow_index_v1')!).flows).toEqual([SUM]);
		await loadFlowIndex({ fetchImpl: fetchImpl as any, getToken: tok, storage, now: 200000 });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		await loadFlowIndex({ fetchImpl: fetchImpl as any, getToken: tok, storage, now: 400000 });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('gagal jaringan → salinan terakhir (cached); tanpa salinan → ringkasan bawaan app (local); tidak melempar', async () => {
		const storage = mem();
		storage.setItem('epi_process_flow_index_v1', JSON.stringify({ at: 1, flows: [SUM] }));
		const boom = vi.fn(async () => { throw new Error('offline'); });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await loadFlowIndex({ fetchImpl: boom as any, getToken: tok, storage })).toMatchObject({ flows: [SUM], source: 'cached' });
		clearFlowLiteMemo();
		const r = await loadFlowIndex({ fetchImpl: boom as any, getToken: tok, storage: mem() });
		expect(r.source).toBe('local');
		expect(r.flows.map((f) => f.id)).toEqual(PROCESS_FLOWS.map((f) => f.id));
		warn.mockRestore();
	});

	it('server fallback / HTTP error / token kosong / salinan rusak → fallback tanpa memo', async () => {
		const bad = vi.fn(async () => res({ success: true, source: 'fallback', flows: [] }));
		expect((await loadFlowIndex({ fetchImpl: bad as any, getToken: tok, storage: mem() })).source).toBe('local');
		expect((await loadFlowIndex({ fetchImpl: (async () => res({}, 500)) as any, getToken: tok, storage: mem() })).source).toBe('local');
		expect((await loadFlowIndex({ fetchImpl: bad as any, getToken: async () => null, storage: mem() })).source).toBe('local');
		const corrupt = mem();
		corrupt.setItem('epi_process_flow_index_v1', '{rusak');
		expect((await loadFlowIndex({ fetchImpl: bad as any, getToken: tok, storage: corrupt })).source).toBe('local');
		// kegagalan tidak di-cache: panggilan berikutnya mencoba lagi
		const ok = vi.fn(async () => res({ success: true, source: 'directus', flows: [SUM] }));
		expect((await loadFlowIndex({ fetchImpl: ok as any, getToken: tok, storage: mem() })).source).toBe('directus');
	});
});

describe('loadFlowById', () => {
	it('?id= terenkode; sukses → disimpan di "alur terakhir" (maks 6), memo per id', async () => {
		const storage = mem();
		const fetchImpl = vi.fn(async (url: string) => res({ success: true, source: 'directus', flow: { ...FLOW, id: decodeURIComponent(url.split('id=')[1]) } }));
		const a = await loadFlowById('alur a/b', { fetchImpl: fetchImpl as any, getToken: tok, storage, now: 0 });
		expect(a.flow?.id).toBe('alur a/b');
		expect((fetchImpl.mock.calls[0] as any)[0]).toBe('/api/process-guidance/flows?id=alur%20a%2Fb');
		await loadFlowById('alur a/b', { fetchImpl: fetchImpl as any, getToken: tok, storage, now: 1000 });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		for (let i = 0; i < 8; i++) await loadFlowById(`f${i}`, { fetchImpl: fetchImpl as any, getToken: tok, storage, now: 0 });
		const stored = JSON.parse(storage._m.get('epi_process_flows_recent_v1')!).flows;
		expect(stored).toHaveLength(6);
		expect(stored[0].id).toBe('f7'); // terbaru di depan
	});

	it('gagal → alur dari salinan terakhir; lalu bawaan app; 404 → flow null (bukan bawaan)', async () => {
		const storage = mem();
		storage.setItem('epi_process_flows_recent_v1', JSON.stringify({ at: 1, flows: [{ ...FLOW, id: 'tersimpan' }] }));
		const boom = vi.fn(async () => { throw new Error('offline'); });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await loadFlowById('tersimpan', { fetchImpl: boom as any, getToken: tok, storage })).toMatchObject({ source: 'cached', flow: { id: 'tersimpan' } });
		const local = await loadFlowById(PROCESS_FLOWS[0].id, { fetchImpl: boom as any, getToken: tok, storage: mem() });
		expect(local).toMatchObject({ source: 'local', flow: { id: PROCESS_FLOWS[0].id } });
		expect((await loadFlowById('tidak-ada', { fetchImpl: boom as any, getToken: tok, storage: mem() })).flow).toBeNull();
		const nf = await loadFlowById('x', { fetchImpl: (async () => res({ success: false }, 404)) as any, getToken: tok, storage: mem() });
		expect(nf).toMatchObject({ flow: null, source: 'directus' });
		warn.mockRestore();
	});

	it('penyimpanan penuh tidak menggagalkan pemuatan', async () => {
		const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
		const fetchImpl = vi.fn(async () => res({ success: true, source: 'directus', flow: FLOW }));
		expect((await loadFlowById('x', { fetchImpl: fetchImpl as any, getToken: tok, storage: full })).flow?.id).toBe('x');
	});
});
