import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));
import { hitungMttr, loadMttrSettings, DEFAULT_MTTR_MIN_SAMPLE, DEFAULT_MTTR_MIN_COVERAGE_PCT } from './maintenanceMttr';
import { directusServerJson } from '$lib/server/directus';

const T = { minSample: 3, minCoveragePct: 60 };
const wo = (done: string | null, created: string | null) => ({ tanggal_done: done, created_at: created });

describe('hitungMttr (berbasis cakupan data) -- sinkron dengan erp-epi', () => {
	it('cakupan & sampel cukup -> rata-rata jam ditampilkan', () => {
		const r = hitungMttr(
			[wo('2026-11-02T10:00:00Z', '2026-11-02T08:00:00Z'), wo('2026-11-02T14:00:00Z', '2026-11-02T08:00:00Z'), wo('2026-11-03T08:00:00Z', '2026-11-02T08:00:00Z'), wo(null, '2026-11-01T08:00:00Z')],
			T
		);
		expect(r).toMatchObject({ mttrReady: true, mttrJam: 10.7, mttrSample: 3, mttrCoveragePct: 75 });
	});
	it('cakupan rendah (kondisi produksi ~8%) -> tidak ditampilkan', () => {
		const rows = [wo('2026-11-02T10:00:00Z', '2026-11-02T08:00:00Z'), wo('2026-11-02T10:00:00Z', '2026-11-02T08:00:00Z'), wo('2026-11-02T10:00:00Z', '2026-11-02T08:00:00Z'), ...Array.from({ length: 12 }, () => wo(null, '2026-11-01T08:00:00Z'))];
		expect(hitungMttr(rows, T)).toMatchObject({ mttrReady: false, mttrJam: null, mttrCoveragePct: 20 });
	});
	it('tanpa WO selesai -> cakupan null', () => {
		expect(hitungMttr([], T)).toMatchObject({ mttrReady: false, mttrCoveragePct: null, mttrSample: 0 });
	});
});

describe('loadMttrSettings', () => {
	it('ambang dari app_settings; gagal baca -> bawaan', async () => {
		vi.mocked(directusServerJson).mockResolvedValueOnce({ data: [{ setting_key: 'ess_mttr_min_sample', setting_value: '8' }] } as never);
		expect(await loadMttrSettings()).toEqual({ minSample: 8, minCoveragePct: DEFAULT_MTTR_MIN_COVERAGE_PCT });
		vi.mocked(directusServerJson).mockRejectedValueOnce(new Error('db down'));
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await loadMttrSettings()).toEqual({ minSample: DEFAULT_MTTR_MIN_SAMPLE, minCoveragePct: DEFAULT_MTTR_MIN_COVERAGE_PCT });
		spy.mockRestore();
	});
});
