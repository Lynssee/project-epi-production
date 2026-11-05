import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
let agingRaw: string | null = '45';
let batchRows: any[] = [];
let settingFails = false;

vi.mock('./directus', () => ({
	directusServerJson: vi.fn(async (path: string) => {
		calls.push(path);
		if (path.startsWith('/items/system_settings')) {
			if (settingFails) throw new Error('down');
			return { data: agingRaw == null ? [] : [{ setting_value: agingRaw }] };
		}
		if (path.startsWith('/items/item_batch')) return { data: batchRows };
		return { data: [] };
	})
}));

const { parseItemIds, getAgingHari, buildExpiryHints, fetchBatchAktif, _resetAgingCacheForTest } = await import('./expiryLapangan');

const NOW = new Date('2026-11-04T08:00:00Z');
beforeEach(() => {
	calls.length = 0;
	agingRaw = '45';
	batchRows = [];
	settingFails = false;
	_resetAgingCacheForTest();
});

describe('parseItemIds', () => {
	it('angka bulat positif unik, sampah dibuang, dibatasi maks', () => {
		expect(parseItemIds('1, 2,2,abc,-3,4.5,0,7')).toEqual([1, 2, 7]);
		expect(parseItemIds('')).toEqual([]);
		expect(parseItemIds(null)).toEqual([]);
		expect(parseItemIds(Array.from({ length: 300 }, (_, i) => i + 1).join(','), 200)).toHaveLength(200);
	});
});

describe('getAgingHari', () => {
	it('membaca setelan ERP, di-cache (hemat API)', async () => {
		expect(await getAgingHari()).toBe(45);
		await getAgingHari();
		expect(calls.filter((c) => c.startsWith('/items/system_settings'))).toHaveLength(1);
	});
	it('setelan belum ada / rusak / Directus gagal → default 30', async () => {
		agingRaw = null;
		expect(await getAgingHari()).toBe(30);
		_resetAgingCacheForTest();
		agingRaw = '"abc"';
		expect(await getAgingHari()).toBe(30);
		_resetAgingCacheForTest();
		settingFails = true;
		const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await getAgingHari()).toBe(30);
		w.mockRestore();
	});
});

describe('buildExpiryHints', () => {
	it('satu query batch per ≤100 barang; hanya batch aktif berstok; ambang dari setelan', async () => {
		batchRows = [
			{ id: 1, item_id: 5, lot_number: 'L1', batch_no_fg: null, tanggal_kadaluarsa: '2026-12-10', qty_tersisa: 3, satuan: 'KG' }, // 36 hari ≤ 45 → prioritas
			{ id: 2, item_id: 6, lot_number: 'L2', batch_no_fg: null, tanggal_kadaluarsa: '2027-09-01', qty_tersisa: 3, satuan: 'KG' }
		];
		const r = await buildExpiryHints([5, 6], NOW);
		expect(r.agingHari).toBe(45);
		expect(r.items[5]).toMatchObject({ status: 'prioritas' });
		expect(r.items[6]).toMatchObject({ status: 'layak' });
		const q = calls.find((c) => c.startsWith('/items/item_batch'))!;
		expect(q).toContain('filter[status][_eq]=active');
		expect(q).toContain('filter[qty_tersisa][_gt]=0');
		expect(q).not.toMatch(/fields=[^&]*\./); // tanpa relasi bersarang
	});
	it('tanpa id → tidak ada query batch', async () => {
		const r = await buildExpiryHints([], NOW);
		expect(r.items).toEqual({});
		expect(calls.some((c) => c.startsWith('/items/item_batch'))).toBe(false);
	});
	it('>100 barang dipecah per 100', async () => {
		await fetchBatchAktif(Array.from({ length: 230 }, (_, i) => i + 1));
		expect(calls.filter((c) => c.startsWith('/items/item_batch'))).toHaveLength(3);
	});
});
