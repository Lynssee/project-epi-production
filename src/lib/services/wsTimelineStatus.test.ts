// WSK-15 §4a — status timeline banyak PO dalam SATU request.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./secureDirectus', () => ({ getIdToken: async () => 'tok' }));
const { fetchWsTimelineStatusBatch } = await import('./wsTimelineStatus');

const fetchMock = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); vi.spyOn(console, 'warn').mockImplementation(() => {}); });

describe('fetchWsTimelineStatusBatch', () => {
	it('satu request berisi semua id unik; hasil dipetakan per id (yang tak ada → null)', async () => {
		fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { batch: true, byProject: { 1: { projectId: 1, found: true, evFlag: 'green' } } } }) });
		const out = await fetchWsTimelineStatusBatch([1, 2, 2, 0, NaN as any], 'balaraja');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const url = fetchMock.mock.calls[0][0] as string;
		expect(url).toContain('project_ids=1%2C2');
		expect(url).toContain('workshop=balaraja');
		expect(out[1]).toMatchObject({ evFlag: 'green' });
		expect(out[2]).toBeNull();
	});
	it('ERP lama (tanpa byProject) / gagal / jaringan putus → {} dan TIDAK jatuh ke N request', async () => {
		fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { projectId: 1, found: false } }) });
		expect(await fetchWsTimelineStatusBatch([1, 2])).toEqual({});
		fetchMock.mockResolvedValue({ ok: false, status: 502 });
		expect(await fetchWsTimelineStatusBatch([1, 2])).toEqual({});
		fetchMock.mockRejectedValue(new TypeError('network'));
		expect(await fetchWsTimelineStatusBatch([1, 2])).toEqual({});
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
	it('daftar kosong → tanpa request', async () => {
		expect(await fetchWsTimelineStatusBatch([])).toEqual({});
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
