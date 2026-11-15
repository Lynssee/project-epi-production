import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/ess/attendanceGuard', () => ({ authenticateEss: vi.fn().mockResolvedValue({}) }));
vi.mock('$lib/server/processGuidanceFlows', () => ({ loadPublishedFlowsForField: vi.fn() }));
vi.mock('$lib/server/processHandoffConfig', () => ({ loadHandoffConfig: vi.fn() }));
vi.mock('$lib/server/processProjectStagesConfig', () => ({ loadProjectStagesConfig: vi.fn() }));

import { GET } from './+server';
import { loadPublishedFlowsForField } from '$lib/server/processGuidanceFlows';
import { loadProjectStagesConfig } from '$lib/server/processProjectStagesConfig';

const load = loadPublishedFlowsForField as unknown as ReturnType<typeof vi.fn>;
const stagesCfg = loadProjectStagesConfig as unknown as ReturnType<typeof vi.fn>;
const callWith = (qs: string) => (GET as any)({ url: new URL('http://x/api/process-guidance/flows' + qs) });
const FLOW = (id: string, tahap?: string[]) => ({ id, title: 'Alur ' + id, description: 'd', lanes: [], nodes: [{ id: 'n1' }, { id: 'n2' }], edges: [], version: 1, sop_code: 'S-' + id, kategori_sop: 'induk', ...(tahap ? { tahap_proyek: tahap } : {}) });

beforeEach(() => {
	vi.clearAllMocks();
	stagesCfg.mockResolvedValue([{ key: 'mobilisasi', label: 'Mobilisasi', urutan: 2, aktif: true, match: { project_status: [], wajib_key: ['mobilisasi'] } }]);
});

describe('GET /api/process-guidance/flows?tahap=1', () => {
	it('hanya alur ber-tahap_proyek, ringkas (tanpa definisi) + daftar tahap', async () => {
		load.mockResolvedValue([FLOW('a', ['mobilisasi']), FLOW('b'), FLOW('c', [])]);
		const body = await (await callWith('?tahap=1')).json();
		expect(body.success).toBe(true);
		expect(body.stages).toHaveLength(1);
		expect(body.flows).toEqual([{ id: 'a', title: 'Alur a', sop_code: 'S-a', kategori_sop: 'induk', sub_kategori: undefined, tahap_proyek: ['mobilisasi'], approval_status: undefined, sosialisasi_end_date: undefined, node_count: 2 }].map((x) => JSON.parse(JSON.stringify(x))));
		expect(JSON.stringify(body)).not.toContain('"lanes"');
	});
	it('tak ada alur bertahap → flows & stages kosong, setelan tahap TIDAK dibaca (hemat query)', async () => {
		load.mockResolvedValue([FLOW('a'), FLOW('b')]);
		const body = await (await callWith('?tahap=1')).json();
		expect(body).toEqual({ success: true, source: 'directus', stages: [], flows: [] });
		expect(stagesCfg).not.toHaveBeenCalled();
	});
	it('Directus gagal → 200 fallback (widget diam), bukan error', async () => {
		load.mockRejectedValue(new Error('boom'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const r = await callWith('?tahap=1');
		expect(r.status).toBe(200);
		expect(await r.json()).toMatchObject({ success: true, source: 'fallback', flows: [] });
		warn.mockRestore();
	});
});
