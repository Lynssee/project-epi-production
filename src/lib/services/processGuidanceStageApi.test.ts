import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadStageFlows, clearStageMemo } from './processGuidanceStageApi';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const FLOW = { id: 'a', title: 'A', tahap_proyek: ['mobilisasi'] };
const deps = (fetchImpl: any) => ({ fetchImpl, getToken: async () => 'tok' });

beforeEach(() => clearStageMemo());

describe('loadStageFlows', () => {
	it('sukses: hanya alur valid; tahap dinormalkan; hasil di-memo (satu panggilan)', async () => {
		const f = vi.fn().mockResolvedValue(ok({ source: 'directus', stages: [{ key: 'mobilisasi', label: 'Mobilisasi', urutan: 1 }], flows: [FLOW, { id: 'x', title: 'tanpa tahap', tahap_proyek: [] }, { bogus: true }] }));
		const r = await loadStageFlows(deps(f));
		expect(r.source).toBe('directus');
		expect(r.flows.map((x) => x.id)).toEqual(['a']);
		expect(r.stages.map((s) => s.key)).toEqual(['mobilisasi']);
		await loadStageFlows(deps(f));
		expect(f).toHaveBeenCalledTimes(1);
		expect(String(f.mock.calls[0][0])).toBe('/api/process-guidance/flows?tahap=1');
	});
	it('tanpa alur bertahap → stages kosong (tidak memaksa bawaan)', async () => {
		const r = await loadStageFlows(deps(vi.fn().mockResolvedValue(ok({ source: 'directus', stages: [], flows: [] }))));
		expect(r).toMatchObject({ source: 'directus', flows: [], stages: [] });
	});
	it('gagal (HTTP, fallback server, jaringan, tanpa token) → kosong, tidak melempar, tidak di-memo', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await loadStageFlows(deps(vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response)))).toMatchObject({ source: 'none', flows: [] });
		expect(await loadStageFlows(deps(vi.fn().mockResolvedValue(ok({ source: 'fallback', flows: [] }))))).toMatchObject({ source: 'none' });
		expect(await loadStageFlows(deps(vi.fn().mockRejectedValue(new Error('net'))))).toMatchObject({ source: 'none' });
		expect(await loadStageFlows({ fetchImpl: vi.fn(), getToken: async () => null })).toMatchObject({ source: 'none', warning: 'Sesi login tidak ditemukan.' });
		const f = vi.fn().mockResolvedValue(ok({ source: 'directus', stages: [], flows: [FLOW] }));
		expect((await loadStageFlows(deps(f))).flows).toHaveLength(1); // pulih setelah kegagalan
		warn.mockRestore();
	});
});
