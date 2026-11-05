import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/ess/attendanceGuard', () => ({ authenticateEss: vi.fn().mockResolvedValue({}) }));
vi.mock('$lib/server/processGuidanceFlows', () => ({ loadPublishedFlowsForField: vi.fn() }));
vi.mock('$lib/server/processHandoffConfig', () => ({ loadHandoffConfig: vi.fn() }));

import { GET } from './+server';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { loadPublishedFlowsForField } from '$lib/server/processGuidanceFlows';
import { loadHandoffConfig } from '$lib/server/processHandoffConfig';

const call = () => (GET as any)({});
const auth = authenticateEss as unknown as ReturnType<typeof vi.fn>;
const load = loadPublishedFlowsForField as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks();
	auth.mockResolvedValue({});
});

describe('GET /api/process-guidance/flows (lapangan)', () => {
	it('wajib login: gagal auth → error dilempar, Directus tidak dibaca', async () => {
		auth.mockRejectedValue(Object.assign(new Error('x'), { status: 401 }));
		await expect(call()).rejects.toMatchObject({ status: 401 });
		expect(load).not.toHaveBeenCalled();
	});

	it('sukses → source directus + flows (kosong tetap directus)', async () => {
		load.mockResolvedValue([{ id: 'a' }]);
		expect(await (await call()).json()).toEqual({ success: true, source: 'directus', flows: [{ id: 'a' }] });
		load.mockResolvedValue([]);
		expect(await (await call()).json()).toEqual({ success: true, source: 'directus', flows: [] });
	});

	it('Directus gagal → 200 source fallback (klien pakai salinan lokal), bukan error', async () => {
		load.mockRejectedValue(new Error('boom'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const r = await call();
		expect(r.status).toBe(200);
		expect(await r.json()).toMatchObject({ success: true, source: 'fallback', flows: [] });
		warn.mockRestore();
	});
});

describe('GET /api/process-guidance/flows — bentuk ringan (hemat kuota)', () => {
	const FLOW = (id: string) => ({ id, title: 'Alur ' + id, description: 'd', lanes: [], nodes: [{ id: 'n1' }, { id: 'n2' }], edges: [], version: 2 });
	const callWith = (qs: string) => (GET as any)({ url: new URL('http://x/api/process-guidance/flows' + qs) });

	it('?lite=1 → ringkasan tanpa definisi (jauh lebih kecil dari seluruh alur)', async () => {
		load.mockResolvedValue([FLOW('a'), FLOW('b')]);
		const body = await (await callWith('?lite=1')).json();
		expect(body).toEqual({ success: true, source: 'directus', flows: [
			{ id: 'a', title: 'Alur a', description: 'd', version: 2, node_count: 2 },
			{ id: 'b', title: 'Alur b', description: 'd', version: 2, node_count: 2 }
		] });
		expect(JSON.stringify(body).length).toBeLessThan(JSON.stringify([FLOW('a'), FLOW('b')]).length);
	});

	it('?id= → satu alur lengkap; id tak dikenal → 404', async () => {
		load.mockResolvedValue([FLOW('a'), FLOW('b')]);
		expect(await (await callWith('?id=b')).json()).toEqual({ success: true, source: 'directus', flow: FLOW('b') });
		const r = await callWith('?id=zzz');
		expect(r.status).toBe(404);
		expect(await r.json()).toMatchObject({ success: false });
	});

	it('?id= tetap wajib login dan Directus gagal tetap fallback 200', async () => {
		auth.mockRejectedValue(Object.assign(new Error('x'), { status: 401 }));
		await expect(callWith('?id=a')).rejects.toMatchObject({ status: 401 });
		auth.mockResolvedValue({});
		load.mockRejectedValue(new Error('boom'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const r = await callWith('?lite=1');
		expect(r.status).toBe(200);
		expect(await r.json()).toMatchObject({ source: 'fallback', flows: [] });
		warn.mockRestore();
	});

	it('tanpa parameter tetap mengembalikan semua alur lengkap (kompatibel dengan klien lama)', async () => {
		load.mockResolvedValue([FLOW('a')]);
		expect(await (await callWith('')).json()).toEqual({ success: true, source: 'directus', flows: [FLOW('a')] });
	});
});


describe('GET /api/process-guidance/flows?chain= — Rantai Serah-Terima', () => {
	const F = (id: string, nodes: string[]) => ({ id, title: 'Alur ' + id, description: '', lanes: [{ key: 'l', label: 'L' }], nodes: nodes.map((n) => ({ id: n, label: 'L-' + n, type: 'task', lane: 'l', col: 0, desc: '' })), edges: [], version: 1 });
	const callWith = (qs: string) => (GET as any)({ url: new URL('http://x/api/process-guidance/flows' + qs) });
	const cfg = { code: 'H1', from_flow: 'a', from_node: 'a1', to_flow: 'b', to_node: 'b1', handoff_type: 'dokumen', doc_label: 'Dok' };

	it('mengembalikan hulu/hilir alur itu saja (kecil), memakai konfigurasi serah-terima', async () => {
		load.mockResolvedValue([F('a', ['a1']), F('b', ['b1'])]);
		(loadHandoffConfig as any).mockResolvedValue([cfg]);
		const body = await (await callWith('?chain=a')).json();
		expect(body.success).toBe(true);
		expect(body.source).toBe('directus');
		expect(body.chain.upstream).toEqual([]);
		expect(body.chain.downstream[0]).toMatchObject({ code: 'H1', flow_id: 'b', flow_title: 'Alur b', node_label: 'L-b1', own_node_label: 'L-a1' });
		expect((await (await callWith('?chain=b')).json()).chain.upstream[0]).toMatchObject({ flow_id: 'a' });
	});
	it('alur tidak ada → 404; wajib login; Directus gagal → fallback 200', async () => {
		load.mockResolvedValue([F('a', ['a1'])]);
		(loadHandoffConfig as any).mockResolvedValue([]);
		expect((await callWith('?chain=zzz')).status).toBe(404);
		auth.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 401 }));
		await expect(callWith('?chain=a')).rejects.toMatchObject({ status: 401 });
		load.mockRejectedValue(new Error('boom'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await (await callWith('?chain=a')).json()).toMatchObject({ source: 'fallback' });
		warn.mockRestore();
	});
});
