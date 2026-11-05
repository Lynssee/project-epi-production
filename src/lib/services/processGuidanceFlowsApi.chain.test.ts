import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFlowChain, clearFlowChainMemo } from './processGuidanceFlowsApi';

const tok = async () => 't';
const res = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => body }) as any;
const mem = () => {
	const m = new Map<string, string>();
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), _m: m };
};
const item = (flow_id: string) => ({ code: 'H1', doc_label: 'Dok', handoff_type: 'dokumen', own_node_id: 'n', own_node_label: 'N', flow_id, flow_title: 'T ' + flow_id, node_id: '', node_label: '' });
const CH = { upstream: [item('a')], downstream: [item('b')] };

beforeEach(() => clearFlowChainMemo());

describe('loadFlowChain (lapangan, offline-first)', () => {
	it('sukses → rantai server; query ?chain= di-encode; Bearer; disimpan ke perangkat; di-memo 5 menit', async () => {
		const storage = mem();
		const fetchImpl = vi.fn(async () => res({ success: true, source: 'directus', chain: CH }));
		const r = await loadFlowChain('a b', { fetchImpl: fetchImpl as any, getToken: tok, storage, now: 0 });
		expect(r).toEqual({ chain: CH, source: 'directus' });
		expect((fetchImpl.mock.calls[0] as any)[0]).toBe('/api/process-guidance/flows?chain=a%20b');
		expect((fetchImpl.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer t');
		expect(JSON.parse(storage._m.get('epi_process_chain_v1')!).items['a b']).toEqual(CH);
		await loadFlowChain('a b', { fetchImpl: fetchImpl as any, getToken: tok, storage, now: 200000 });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
	it('jaringan putus → salinan terakhir di perangkat (cached); tanpa salinan → chain null (bukan galat)', async () => {
		const storage = mem();
		await loadFlowChain('x', { fetchImpl: (async () => res({ success: true, source: 'directus', chain: CH })) as any, getToken: tok, storage, now: 0 });
		clearFlowChainMemo();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const down = (async () => { throw new Error('offline'); }) as any;
		expect(await loadFlowChain('x', { fetchImpl: down, getToken: tok, storage, now: 1 })).toMatchObject({ chain: CH, source: 'cached' });
		expect(await loadFlowChain('lain', { fetchImpl: down, getToken: tok, storage, now: 1 })).toMatchObject({ chain: null, source: 'local' });
		warn.mockRestore();
	});
	it('404 → null tanpa fallback; payload rusak / server fallback → memakai salinan; tanpa token → null', async () => {
		const storage = mem();
		expect(await loadFlowChain('z', { fetchImpl: (async () => res({ success: false }, 404)) as any, getToken: tok, storage })).toMatchObject({ chain: null, source: 'directus' });
		expect(await loadFlowChain('z', { fetchImpl: (async () => res({ success: true, source: 'fallback', flows: [] })) as any, getToken: tok, storage })).toMatchObject({ chain: null, source: 'local' });
		expect(await loadFlowChain('z', { fetchImpl: (async () => res({ success: true, source: 'directus', chain: { upstream: 1 } })) as any, getToken: tok, storage })).toMatchObject({ chain: null });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect((await loadFlowChain('z', { getToken: async () => null, storage })).chain).toBeNull();
		warn.mockRestore();
	});
	it('penyimpanan dibatasi 12 alur (yang terbaru dipertahankan)', async () => {
		const storage = mem();
		for (let i = 0; i < 15; i++) await loadFlowChain(`f${i}`, { fetchImpl: (async () => res({ success: true, source: 'directus', chain: CH })) as any, getToken: tok, storage, now: i });
		const keys = Object.keys(JSON.parse(storage._m.get('epi_process_chain_v1')!).items);
		expect(keys).toHaveLength(12);
		expect(keys[0]).toBe('f14');
		expect(keys).not.toContain('f0');
	});
});
