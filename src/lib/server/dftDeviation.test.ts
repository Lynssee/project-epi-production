import { describe, it, expect, vi, beforeEach } from 'vitest';

const state: { enabled: any; report: any; charters: any[]; object: any; readings: any[]; calls: string[] } = {
	enabled: true, report: null, charters: [], object: null, readings: [], calls: []
};
const notify = vi.fn(async () => {});

vi.mock('./directus', () => ({
	directusServerJson: vi.fn(async (url: string) => {
		state.calls.push(url);
		if (url.startsWith('/items/system_settings')) return { data: state.enabled === undefined ? [] : [{ setting_value: JSON.stringify(state.enabled) }] };
		if (url.startsWith('/items/inspection_report/')) return { data: state.report };
		if (url.startsWith('/items/project_charters')) return { data: state.charters };
		if (url.startsWith('/items/project_objects')) return { data: state.object ? [state.object] : [] };
		if (url.startsWith('/items/inspection_dft_reading')) return { data: state.readings };
		if (url.startsWith('/items/projects/')) return { data: { id: 7, name: 'Tangki A' } };
		return { data: [] };
	})
}));
vi.mock('./projectNotify', () => ({ notifyProjectDftDeviation: notify }));

const mod = await import('./dftDeviation');

const spec = { sistem_lapisan: [{ target_micron: 100, toleransi_min: 80, toleransi_max: 120 }, { target_micron: 50 }] };
let rid = 100;
beforeEach(() => {
	notify.mockClear();
	state.enabled = true;
	state.report = { id: ++rid, project_id: 7, report_no: 'IREPIOG-001' };
	state.charters = [{ id: 11 }];
	state.object = { id: 5, nama_objek: 'Pipa 8in', spesifikasi_teknis: spec };
	state.readings = [{ layer_no: 1, value_um: 60 }, { layer_no: 1, value_um: 70 }, { layer_no: 2, value_um: 50 }];
	state.calls = [];
});

describe('buildDftDeviations', () => {
	it('hanya layer yang menyimpang dan punya acuan', () => {
		const d = mod.buildDftDeviations({ 1: [60, 70], 2: [50, 52], 3: [10] }, spec);
		expect(d).toEqual([{ layerNo: 1, status: 'kurang', avg: 65, target: 100, min: 80, max: 120 }]);
	});
	it('over-thickness dan spesifikasi kosong', () => {
		expect(mod.buildDftDeviations({ 1: [150] }, spec)[0].status).toBe('over');
		expect(mod.buildDftDeviations({ 1: [150] }, null)).toEqual([]);
	});
});

describe('evaluateAndNotifyDftDeviation', () => {
	it('saklar mati (fail-closed) → tidak menarik data laporan sama sekali', async () => {
		state.enabled = false;
		expect(await mod.evaluateAndNotifyDftDeviation(1, 5)).toEqual({ sent: false, reason: 'disabled' });
		expect(state.calls.some((c) => c.startsWith('/items/inspection_report'))).toBe(false);
		expect(notify).not.toHaveBeenCalled();
	});
	it('setelan belum ada di database → dianggap mati', async () => {
		state.enabled = undefined;
		expect((await mod.evaluateAndNotifyDftDeviation(1, 5)) as any).toMatchObject({ sent: false, reason: 'disabled' });
	});
	it('menyimpang → kirim sekali dengan data hasil hitung server; relasi diambil terpisah', async () => {
		const r = await mod.evaluateAndNotifyDftDeviation(rid, 5);
		expect(r.sent).toBe(true);
		expect(notify).toHaveBeenCalledTimes(1);
		expect((notify.mock.calls[0] as any[])[0]).toMatchObject({ projectName: 'Tangki A', objectName: 'Pipa 8in', reportNo: 'IREPIOG-001' });
		expect(state.calls.join(' ')).not.toContain('project_charter_id.project_id');
		expect(state.calls.find((c) => c.startsWith('/items/project_objects'))).toContain('filter[project_charter_id][_in]=11');
	});
	it('panggilan ulang dengan data sama dalam 1 jam → throttled', async () => {
		await mod.evaluateAndNotifyDftDeviation(rid, 5);
		notify.mockClear();
		expect(await mod.evaluateAndNotifyDftDeviation(rid, 5)).toEqual({ sent: false, reason: 'throttled' });
		expect(notify).not.toHaveBeenCalled();
	});
	it('objek bukan milik proyek laporan → tidak dinilai (cegah penyalahgunaan objectId)', async () => {
		state.object = null;
		expect(await mod.evaluateAndNotifyDftDeviation(rid, 999)).toEqual({ sent: false, reason: 'no_spec' });
		expect(notify).not.toHaveBeenCalled();
	});
	it('semua layer dalam toleransi → tidak ada notifikasi', async () => {
		state.readings = [{ layer_no: 1, value_um: 100 }, { layer_no: 2, value_um: 50 }];
		expect(await mod.evaluateAndNotifyDftDeviation(rid, 5)).toEqual({ sent: false, reason: 'no_deviation' });
	});
	it('laporan tanpa proyek / tidak ditemukan', async () => {
		state.report = { id: 1, project_id: null };
		expect((await mod.evaluateAndNotifyDftDeviation(1, 5)) as any).toMatchObject({ reason: 'no_project' });
		state.report = null;
		expect((await mod.evaluateAndNotifyDftDeviation(1, 5)) as any).toMatchObject({ reason: 'not_found' });
	});
});
