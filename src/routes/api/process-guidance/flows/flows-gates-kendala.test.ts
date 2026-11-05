import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/ess/attendanceGuard', () => ({ authenticateEss: vi.fn().mockResolvedValue({}) }));
vi.mock('$lib/server/processGuidanceFlows', () => ({ loadPublishedFlowsForField: vi.fn() }));
vi.mock('$lib/server/processHandoffConfig', () => ({ loadHandoffConfig: vi.fn() }));
vi.mock('./gateInfo', () => ({ loadGateInfoForFlow: vi.fn() }));

import { GET } from './+server';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { loadPublishedFlowsForField } from '$lib/server/processGuidanceFlows';
import { loadGateInfoForFlow } from './gateInfo';

const load = loadPublishedFlowsForField as unknown as ReturnType<typeof vi.fn>;
const info = loadGateInfoForFlow as unknown as ReturnType<typeof vi.fn>;
const ev = (qs: string, authorization = 'Bearer abc') => ({ url: new URL(`http://x/api/process-guidance/flows${qs}`), request: { headers: new Headers({ authorization }) } });
const call = (qs: string) => (GET as any)(ev(qs));
const FLOWS = [
	{ id: 'lh', title: 'Laporan Harian', lanes: [], edges: [], description: '', nodes: [{ id: 'foto', label: 'Foto BA', desc: '', blockers: ['Foto BA belum diunggah'], gates: [{ key: 'G_FOTO', modul: 'm', documentType: 'd' }] }] }
];

beforeEach(() => {
	vi.clearAllMocks();
	(authenticateEss as any).mockResolvedValue({});
	load.mockResolvedValue(FLOWS);
});

describe('GET ?gates=<alur>', () => {
	it('wajib login; token pemanggil diteruskan ke pembaca gate; hasil dibungkus success', async () => {
		info.mockResolvedValue({ available: true, gates: { G_FOTO: { mode: 'hard' } } });
		const r = await call('?gates=lh');
		expect(await r.json()).toEqual({ success: true, source: 'directus', available: true, gates: { G_FOTO: { mode: 'hard' } } });
		expect(info).toHaveBeenCalledWith(FLOWS[0], 'Bearer abc');
		(authenticateEss as any).mockRejectedValue(Object.assign(new Error('x'), { status: 401 }));
		await expect(call('?gates=lh')).rejects.toMatchObject({ status: 401 });
	});
	it('alur tak dikenal → 404; admin tak terjangkau tetap 200 (available:false) agar kartu tidak error', async () => {
		expect((await call('?gates=tidak_ada')).status).toBe(404);
		info.mockResolvedValue({ available: false, gates: {}, reason: 'admin 503' });
		const r = await call('?gates=lh');
		expect(r.status).toBe(200);
		expect(await r.json()).toMatchObject({ success: true, available: false, reason: 'admin 503' });
	});
});

describe('GET ?kendala=<kata>', () => {
	it('mengembalikan hasil kecil lintas alur tanpa mengunduh alur', async () => {
		const j = await (await call('?kendala=foto%20ba')).json();
		expect(j.success).toBe(true);
		expect(j.hits).toEqual([{ flow_id: 'lh', flow_title: 'Laporan Harian', node_id: 'foto', node_label: 'Foto BA', kind: 'kendala', snippet: 'Foto BA belum diunggah' }]);
		expect(j.flows).toBeUndefined();
	});
	it('kueri terlalu pendek → kosong tanpa membaca alur', async () => {
		expect(await (await call('?kendala=a')).json()).toEqual({ success: true, hits: [] });
		expect(load).not.toHaveBeenCalled();
	});
});
