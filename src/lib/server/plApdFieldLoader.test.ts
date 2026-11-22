import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFieldApd, resetApdFieldCache } from './plApdFieldLoader';

function fetcher(routes: Array<[string, any]>) {
	const calls: string[] = [];
	const fn = vi.fn(async (url: string) => {
		calls.push(url);
		for (const [frag, resp] of routes) if (url.includes(frag)) { if (resp instanceof Error) throw resp; return resp; }
		return { data: [] };
	});
	return { fn, calls };
}
beforeEach(() => resetApdFieldCache());

describe('loadFieldApd (apd-basics lapangan)', () => {
	it('menghitung kebutuhan dari penugasan aktif; penugasan lewat tanggal dibuang; stok & komit dikembalikan', async () => {
		const f = fetcher([
			['/items/manpower_assignment', { data: [
				{ manpower_id: 1, jabatan: 'Helper', tanggal_selesai: null },
				{ manpower_id: 2, jabatan: 'Blaster', tanggal_selesai: '2099-01-01' },
				{ manpower_id: 3, jabatan: 'Lama', tanggal_selesai: '2020-01-01' }
			] }],
			['/items/packing_list?', { data: [{ id: 1 }] }],
			['/items/packing_list_items', { data: [{ nama_barang: 'HELM SAFETY', qty_required: 2, unit: 'Pcs' }] }],
			['/items/project_stock_balance', { data: [{ item_id: 7, qty_received: 3 }] }],
			['/items/identitas_barang', { data: [{ id: 7, nama_barang_lengkap: 'SARUNG TANGAN KAIN', satuan: 'Pcs' }] }]
		]);
		const r = await loadFieldApd(9, f.fn as any);
		expect(r.persons).toBe(2);
		expect(r.need.find((i: any) => i.label === 'Helm safety').needed).toBe(2);
		expect(r.need.find((i: any) => i.label === 'Respirator').needed).toBe(1);
		expect(r.committed).toEqual([{ nama_barang: 'HELM SAFETY', qty: 2, unit: 'Pcs' }]);
		expect(r.siteReceived).toEqual([{ nama_barang: 'SARUNG TANGAN KAIN', qty: 3, unit: 'Pcs' }]);
	});

	it('tanpa pekerja aktif ⇒ persons 0 dan TIDAK query PL/stok (hemat API)', async () => {
		const f = fetcher([['/items/manpower_assignment', { data: [{ manpower_id: 3, jabatan: 'Lama', tanggal_selesai: '2020-01-01' }] }]]);
		const r = await loadFieldApd(9, f.fn as any);
		expect(r.persons).toBe(0);
		expect(f.calls.some((c) => c.includes('packing_list') || c.includes('project_stock_balance'))).toBe(false);
	});

	it('gagal baca penugasan ⇒ kosong (dilog), tidak melempar', async () => {
		const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const f = fetcher([['/items/manpower_assignment', new Error('403')]]);
		expect((await loadFieldApd(9, f.fn as any)).persons).toBe(0);
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it('aturan dari app_settings dipakai (JSON string)', async () => {
		const rules = { min_coverage_pct: 50, groups: [{ key: 'x', label: 'X', all: true, items: [{ label: 'Rompi', keywords: ['ROMPI'], qty_per_person: 2, mandatory: true }] }] };
		const f = fetcher([
			['pkl_apd.requirements', { data: [{ setting_value: JSON.stringify(rules) }] }],
			['/items/manpower_assignment', { data: [{ manpower_id: 1, jabatan: 'Helper' }] }]
		]);
		const r = await loadFieldApd(9, f.fn as any);
		expect(r.min_coverage_pct).toBe(50);
		expect(r.need).toEqual([expect.objectContaining({ label: 'Rompi', needed: 2 })]);
	});
});
