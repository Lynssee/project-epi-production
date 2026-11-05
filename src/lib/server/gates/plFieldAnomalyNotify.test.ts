// Alert anomali sisi lapangan (Rencana Gate Rasionalitas PL, Fase 5+).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const envMock: Record<string, string> = { PL_ANOMALY_N8N_WEBHOOK_URL: 'https://n8n.test/webhook/pl-anomaly' };
vi.mock('$env/dynamic/private', () => ({ env: envMock }));
vi.mock('../gateDefinitionsMode', () => ({ resolveGateMode: vi.fn(async () => 'shadow') }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));

const { notifyFieldAnomaly, collectFieldAnomalies, resetFieldAnomalyNotifyState } = await import('./plFieldAnomalyNotify');
const { resetFieldCoverageCache } = await import('./plFieldCoverageLoader');

const OX955 = { id: 'r1', code: 'OX-955', name: 'Foxafloor SLW', unit: 'kg', default_consumption: 0.6 };
const mkDx = (extra: Array<[string, any]> = []) => {
	const map: Array<[string, any]> = [
		...extra, // override spesifik harus dicek lebih dulu daripada rute dasar
		['/items/app_settings', { data: [] }],
		['fields=id,max_consumption', { data: [] }],
		['/items/kalkulator_material_rate', { data: [OX955] }],
		['/items/projects/', { data: { id: 10, total_area_m2: 10 } }],
		['/items/project_charters', { data: [] }],
		['/items/identitas_barang', { data: [{ id: 15, fill_weight_kg: 20 }] }]
	];
	return vi.fn(async (path: string) => {
		for (const [frag, resp] of map) if (path.includes(frag)) return resp;
		return { data: [] };
	});
};
const row = (qty: number, over: any = {}) => ({
	id: 1, project_id: 10, qty, unit: 'Pail', identitas_barang_id: 15, material_name: 'FOXAFLOOR SLW : OX-955 GREY', ...over
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
	resetFieldAnomalyNotifyState();
	resetFieldCoverageCache();
	envMock.PL_ANOMALY_N8N_WEBHOOK_URL = 'https://n8n.test/webhook/pl-anomaly';
	fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('collectFieldAnomalies (murni)', () => {
	const res = { coverage: { items: [{ status: 'over', overPct: 900, nama_barang: 'A', qty: 10, unit: 'Pail' }, { status: 'over', overPct: 40, nama_barang: 'B' }, { status: 'ok' }] }, runrate: { items: [{ status: 'over', overPct: 300, nama_barang: 'C' }] } };
	it('hanya ≥ ambang & terurut; ambang 0/NaN ⇒ nonaktif', () => {
		expect(collectFieldAnomalies(res, 150).map((a) => a.nama)).toEqual(['A', 'C']);
		expect(collectFieldAnomalies(res, 0)).toEqual([]);
		expect(collectFieldAnomalies(res, NaN)).toEqual([]);
		expect(collectFieldAnomalies({}, 150)).toEqual([]);
	});
});

describe('notifyFieldAnomaly', () => {
	it('10 Pail di 10 m² ⇒ kirim sekali, payload kompatibel dengan sisi admin', async () => {
		const r = await notifyFieldAnomaly([row(10) as any], mkDx(), { source: 'field_submit', sourceId: 55 });
		expect(r.sent).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as any[];
		expect(url).toBe('https://n8n.test/webhook/pl-anomaly');
		expect(init.headers['X-Automated-By']).toBe('project-epi-pl-anomaly');
		expect(JSON.parse(init.body)).toMatchObject({
			event: 'pl_anomaly_detected', source: 'field_submit', project_id: 10, area_m2: 10, max_over_pct: 900, item_count: 1, source_app: 'project-epi', source_row_id: 55
		});
	});
	it('dedupe: kasus sama tidak dikirim ulang; qty beda = kasus beda', async () => {
		await notifyFieldAnomaly([row(10) as any], mkDx());
		await notifyFieldAnomaly([row(10) as any], mkDx());
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await notifyFieldAnomaly([row(12) as any], mkDx());
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
	it('webhook belum dikonfigurasi ⇒ NOL query Directus tambahan & tidak kirim', async () => {
		envMock.PL_ANOMALY_N8N_WEBHOOK_URL = '';
		const dx = mkDx();
		const r = await notifyFieldAnomaly([row(10) as any], dx);
		expect(r).toMatchObject({ sent: false, reason: 'webhook_not_configured' });
		expect(fetchMock).not.toHaveBeenCalled();
		expect(dx).toHaveBeenCalledTimes(1); // hanya cek URL di app_settings
	});
	it('qty wajar / luasan kosong / ambang 0 ⇒ tidak kirim', async () => {
		expect((await notifyFieldAnomaly([row(1) as any], mkDx())).sent).toBe(false);
		expect((await notifyFieldAnomaly([row(10) as any], mkDx([['/items/projects/', { data: { id: 10, total_area_m2: null } }]]))).sent).toBe(false);
		resetFieldCoverageCache();
		const off = mkDx([['/items/app_settings?filter[module][_eq]=project&filter[setting_key][_starts_with]', { data: [{ setting_key: 'pkl_coverage.extreme_alert_pct', setting_value: 0 }] }]]);
		expect((await notifyFieldAnomaly([row(10) as any], off)).sent).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it('baris non-barang diabaikan; fetch gagal ⇒ tidak melempar', async () => {
		expect((await notifyFieldAnomaly([row(10, { no_item_needed: true }) as any], mkDx())).sent).toBe(false);
		fetchMock.mockRejectedValueOnce(new Error('timeout'));
		await expect(notifyFieldAnomaly([row(10) as any], mkDx())).resolves.toMatchObject({ sent: false });
	});
});
