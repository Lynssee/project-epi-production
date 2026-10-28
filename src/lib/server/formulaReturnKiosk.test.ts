import { describe, it, expect, vi, beforeEach } from 'vitest';

const directusServerJson = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: unknown[]) => directusServerJson(...a) }));

const { parseSpkScan, waitDays, markFormulaReturnedKiosk, listPendingFormula, getSpkFormulaState } = await import('./formulaReturnKiosk');

const NOW = new Date('2026-10-19T05:00:00Z');
let spk: Record<string, any>;
let events: any[];
let settingRows: any[];

// Mock meniru Directus: PATCH massal WAJIB { query:{filter}, data } (pelajaran 17 Okt 2026).
function install() {
	directusServerJson.mockImplementation(async (path: string, init: any = {}) => {
		const method = (init.method || 'GET').toUpperCase();
		if (path.startsWith('/items/app_settings')) return { data: settingRows };
		if (method === 'PATCH' && path === '/items/spk') {
			const body = JSON.parse(init.body);
			if (!body.query?.filter || !body.data) throw new Error('HTTP 400 "data" is required');
			const conds = body.query.filter._and;
			const id = conds.find((c: any) => c.id)?.id._eq;
			const needNull = conds.some((c: any) => c.formula_returned_at?._null === true);
			const statuses = conds.find((c: any) => c.status)?.status._in ?? [];
			const hit = spk.id === id && (!needNull || !spk.formula_returned_at) && statuses.includes(spk.status);
			if (hit) Object.assign(spk, body.data);
			return { data: hit ? [{ id: spk.id }] : [] };
		}
		if (method === 'POST' && path === '/items/spk_formula_events') { events.push(JSON.parse(init.body)); return { data: {} }; }
		if (path.startsWith('/items/spk?')) return { data: [spk], meta: { filter_count: 1 } };
		if (path.startsWith('/items/identitas_barang')) return { data: [{ id: 5, nama_barang_lengkap: 'Epoxy A' }] };
		if (path.startsWith('/items/master_customer')) return { data: [{ id: 9, nama_sj_fp: 'PT Contoh' }] };
		throw new Error(`path tak dikenal: ${path}`);
	});
}

beforeEach(() => {
	directusServerJson.mockReset();
	spk = { id: 77, nomor: 'SPK-77', status: 'worksheet_generated', worksheet_generated_date: '2026-10-16T05:00:00Z', product_id: 5, customer_id: 9, formula_returned_at: null, formula_returned_by: null };
	events = [];
	settingRows = [];
	install();
});

describe('parseSpkScan', () => {
	it('menerima QR SPK, URL scan, dan angka polos; menolak yang lain', () => {
		expect(parseSpkScan('EPI:SPK:77:77')).toBe(77);
		expect(parseSpkScan('https://project.eltamaprimaindo.com/scan/EPI%3ASPK%3A77%3A77')).toBe(77);
		expect(parseSpkScan(' 77 ')).toBe(77);
		expect(parseSpkScan('EPI:SJ:5:abc')).toBeNull();
		expect(parseSpkScan('EPI:ITEM:5')).toBeNull();
		expect(parseSpkScan('abc')).toBeNull();
		expect(parseSpkScan('')).toBeNull();
		expect(parseSpkScan(null)).toBeNull();
	});
});

describe('waitDays', () => {
	it('hari penuh, tanggal rusak → null, tidak negatif', () => {
		expect(waitDays('2026-10-16T05:00:00Z', NOW)).toBe(3);
		expect(waitDays(null, NOW)).toBeNull();
		expect(waitDays('x', NOW)).toBeNull();
		expect(waitDays('2026-10-25T00:00:00Z', NOW)).toBe(0);
	});
});

describe('markFormulaReturnedKiosk', () => {
	it('pertama: menandai dengan actor kiosk + metode, mencatat event returned', async () => {
		const r = await markFormulaReturnedKiosk(77, 'Budi (kiosk #12)', 'scan', NOW);
		expect(r).toEqual({ ok: true, changed: true, eventLogged: true });
		expect(spk).toMatchObject({ formula_returned_by: 'Budi (kiosk #12)', formula_return_method: 'scan', formula_returned_at: NOW.toISOString() });
		expect(events[0]).toMatchObject({ spk_id: 77, event_type: 'returned', actor: 'Budi (kiosk #12)', channel: 'scan', payload: { duplicate: false } });
	});

	it('kedua: tanda pertama tidak ditimpa; dilaporkan sudah kembali + event duplikat', async () => {
		await markFormulaReturnedKiosk(77, 'Budi (kiosk #12)', 'scan', NOW);
		const first = spk.formula_returned_at;
		const r = await markFormulaReturnedKiosk(77, 'Ani (kiosk #3)', 'manual', new Date('2026-10-20T00:00:00Z'));
		expect(r).toMatchObject({ ok: true, changed: false, reason: 'already_returned', by: 'Budi (kiosk #12)' });
		expect(spk.formula_returned_at).toBe(first);
		expect(events.at(-1).payload.duplicate).toBe(true);
	});

	it('status sudah berjalan → not_eligible tanpa mengubah; SPK tak ada → not_found', async () => {
		spk.status = 'in_progress';
		expect(await markFormulaReturnedKiosk(77, 'x', 'manual', NOW)).toEqual({ ok: false, reason: 'not_eligible', status: 'in_progress' });
		expect(spk.formula_returned_at).toBeNull();
		spk.id = 1; // PATCH tidak match & lookup mengembalikan baris lain → tetap dianggap ada; uji not_found lewat lookup kosong
		directusServerJson.mockImplementation(async (path: string, init: any = {}) => {
			if (path.startsWith('/items/app_settings')) return { data: [] };
			if ((init.method || 'GET') === 'PATCH') return { data: [] };
			if (path.startsWith('/items/spk?')) return { data: [] };
			return { data: [] };
		});
		expect(await markFormulaReturnedKiosk(99, 'x', 'manual', NOW)).toEqual({ ok: false, reason: 'not_found' });
	});

	it('saklar nonaktif → disabled, tidak menulis apa pun', async () => {
		settingRows = [{ setting_value: 'false' }];
		const r = await markFormulaReturnedKiosk(77, 'x', 'manual', NOW);
		expect(r).toEqual({ ok: false, reason: 'disabled' });
		expect(spk.formula_returned_at).toBeNull();
		expect(events).toHaveLength(0);
	});

	it('gagal mencatat event: SPK tetap tertandai, eventLogged=false (tidak diam, tidak membatalkan)', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const base = directusServerJson.getMockImplementation()!;
		directusServerJson.mockImplementation(async (path: string, init: any = {}) => {
			if (path === '/items/spk_formula_events') throw new Error('HTTP 403');
			return base(path, init);
		});
		const r = await markFormulaReturnedKiosk(77, 'x', 'manual', NOW);
		expect(r).toEqual({ ok: true, changed: true, eventLogged: false });
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it('error Directus pada PATCH dilempar (tidak ditelan)', async () => {
		directusServerJson.mockImplementation(async (path: string, init: any = {}) => {
			if (path.startsWith('/items/app_settings')) return { data: [] };
			if ((init.method || 'GET') === 'PATCH') throw new Error('HTTP 503');
			return { data: [] };
		});
		await expect(markFormulaReturnedKiosk(77, 'x', 'manual', NOW)).rejects.toThrow('HTTP 503');
	});
});

describe('listPendingFormula / getSpkFormulaState', () => {
	it('daftar: nama produk/customer & hari menunggu; relasi di-fetch terpisah (tanpa field bersarang)', async () => {
		const out = await listPendingFormula(50, NOW);
		expect(out.total).toBe(1);
		expect(out.items[0]).toMatchObject({ id: 77, nomor: 'SPK-77', product: 'Epoxy A', customer: 'PT Contoh', days: 3 });
		const paths = directusServerJson.mock.calls.map((c) => String(c[0]));
		expect(paths.some((p) => /fields=[^&]*\./.test(p))).toBe(false);
	});

	it('detail: returned=false awalnya; true setelah ditandai', async () => {
		expect((await getSpkFormulaState(77, NOW))?.returned).toBe(false);
		await markFormulaReturnedKiosk(77, 'Budi', 'scan', NOW);
		expect((await getSpkFormulaState(77, NOW))).toMatchObject({ returned: true, returned_by: 'Budi' });
	});
});
