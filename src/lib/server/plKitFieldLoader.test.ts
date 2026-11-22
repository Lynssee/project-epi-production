import { describe, it, expect, vi } from 'vitest';
import { loadFieldKit } from './plKitFieldLoader';

function fetcher(routes: Array<[string, any]>) {
	const calls: string[] = [];
	const fn = vi.fn(async (url: string) => {
		calls.push(url);
		for (const [frag, resp] of routes) if (url.includes(frag)) { if (resp instanceof Error) throw resp; return resp; }
		return { data: [] };
	});
	return { fn, calls };
}

describe('loadFieldKit (kit-basics lapangan)', () => {
	it('proyek floor coating ⇒ kit berlaku + nama komit & stok site', async () => {
		const f = fetcher([
			['/items/projects/9', { data: { id: 9, jenis_project: 'Epoxy / Floor Coating', hse_work_types: [] } }],
			['/items/packing_list?', { data: [{ id: 1 }, { id: 2 }] }],
			['/items/packing_list_items', { data: [{ nama_barang: 'HYGROMETER ELCOMETER' }, { nama_barang: null }] }],
			['/items/project_stock_balance', { data: [{ item_id: 7 }, { item_id: { id: 7 } }] }],
			['/items/identitas_barang', { data: [{ nama_barang_lengkap: 'MOISTURE TESTER NO. 01' }] }]
		]);
		const r = await loadFieldKit(9, f.fn as any);
		expect(r.kits.map((k: any) => k.key)).toEqual(['floor_coating']);
		expect(r.committed).toEqual(['HYGROMETER ELCOMETER']);
		expect(r.site).toEqual(['MOISTURE TESTER NO. 01']);
		expect(f.calls.filter((c) => c.includes('identitas_barang'))).toHaveLength(1);
	});

	it('jenis pekerjaan tanpa kit ⇒ kosong dan TIDAK query PL/stok (hemat API)', async () => {
		const f = fetcher([['/items/projects/9', { data: { id: 9, jenis_project: 'Rental', hse_work_types: [] } }]]);
		const r = await loadFieldKit(9, f.fn as any);
		expect(r).toEqual({ kits: [], committed: [], site: [] });
		expect(f.calls.some((c) => c.includes('packing_list'))).toBe(false);
	});

	it('gagal baca proyek ⇒ kosong (dilog), tidak melempar', async () => {
		const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const f = fetcher([['/items/projects/9', new Error('403')]]);
		expect(await loadFieldKit(9, f.fn as any)).toEqual({ kits: [], committed: [], site: [] });
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it('gagal baca stok site ⇒ kit tetap dikembalikan dengan site kosong', async () => {
		const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const f = fetcher([
			['/items/projects/9', { data: { id: 9, jenis_project: 'Sandblasting', hse_work_types: '["sandblasting"]' } }],
			['/items/project_stock_balance', new Error('boom')]
		]);
		const r = await loadFieldKit(9, f.fn as any);
		expect(r.kits).toHaveLength(1);
		expect(r.site).toEqual([]);
		spy.mockRestore();
	});
});
