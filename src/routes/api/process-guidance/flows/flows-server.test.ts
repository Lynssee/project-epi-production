import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/ess/attendanceGuard', () => ({ authenticateEss: vi.fn().mockResolvedValue({}) }));
vi.mock('$lib/server/processGuidanceFlows', () => ({ loadPublishedFlowsForField: vi.fn() }));

import { GET } from './+server';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { loadPublishedFlowsForField } from '$lib/server/processGuidanceFlows';

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
