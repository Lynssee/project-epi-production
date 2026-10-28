// src/lib/server/processGuidanceFlows.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));
import { directusServerJson } from '$lib/server/directus';
import { loadPublishedFlowsForField, clearProcessGuidanceFlowsCache } from './processGuidanceFlows';

const row = (key: string, extra: any = {}) => ({
	flow_key: key, title: key, description: '', target_app: 'both', urutan: 0, version: 1,
	definition: { lanes: [{ key: 'a', label: 'A' }], nodes: [{ id: 'n1', type: 'start', lane: 'a', col: 0, label: 'M', actions_field: [{ label: 'L', href: '/x' }], gates: [{ key: 'G', modul: 'm', documentType: 'd' }] }], edges: [] },
	...extra
});
const mock = directusServerJson as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks();
	clearProcessGuidanceFlowsCache();
});

describe('loadPublishedFlowsForField', () => {
	it('satu query tanpa relasi: published + target project-epi/both, field eksplisit', async () => {
		mock.mockResolvedValue({ data: [row('a')] });
		const flows = await loadPublishedFlowsForField();
		expect(flows).toHaveLength(1);
		expect(flows[0].nodes[0].actions).toEqual([{ label: 'L', href: '/x' }]);
		expect((flows[0].nodes[0] as any).gates).toBeUndefined();
		expect(mock).toHaveBeenCalledTimes(1);
		const url = mock.mock.calls[0][0] as string;
		expect(url).toContain('filter[status][_eq]=published');
		expect(url).toContain('filter[target_app][_in]=project-epi,both');
		expect(url).toContain('fields=flow_key,title,description,target_app,urutan,version,definition');
		expect(url).not.toMatch(/fields=[^&]*\./);
	});

	it('baris rusak dilewati (console.warn), sehat tetap', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mock.mockResolvedValue({ data: [{ flow_key: 'rusak', definition: '{x' }, row('ok')] });
		expect((await loadPublishedFlowsForField()).map((f) => f.id)).toEqual(['ok']);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it('cache 5 menit lalu kedaluwarsa; gagal → melempar & tidak di-cache', async () => {
		mock.mockResolvedValue({ data: [] });
		await loadPublishedFlowsForField({ now: 0 });
		await loadPublishedFlowsForField({ now: 200000 });
		expect(mock).toHaveBeenCalledTimes(1);
		await loadPublishedFlowsForField({ now: 400000 });
		expect(mock).toHaveBeenCalledTimes(2);
		clearProcessGuidanceFlowsCache();
		mock.mockRejectedValueOnce(new Error('403'));
		await expect(loadPublishedFlowsForField()).rejects.toThrow('403');
		mock.mockResolvedValueOnce({ data: [] });
		await expect(loadPublishedFlowsForField()).resolves.toEqual([]);
	});

	it('data bukan array → kosong', async () => {
		mock.mockResolvedValue({ data: null });
		expect(await loadPublishedFlowsForField()).toEqual([]);
	});
});
