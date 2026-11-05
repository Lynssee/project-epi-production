// PRJ-11 — barang PL di luar RAP: batch POST, nominal approval dari estimasi, rollback bila approval gagal.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ url: string; method: string; body?: string }> = [];
let approvalFails = false;
let nonRapThreshold: string | null = null;
let templateRows: any[] = [];

vi.mock('./directus', () => ({
	directusServerJson: vi.fn(async (url: string, opts: any = {}) => {
		const method = opts.method || 'GET';
		calls.push({ url, method, body: opts.body });
		if (url === '/items/project_budgets' && method === 'POST') {
			const rows = JSON.parse(opts.body);
			return { data: rows.map((_: any, i: number) => ({ id: 500 + i })) };
		}
		if (url.startsWith('/items/project_budgets?')) return { data: templateRows };
		if (url.startsWith('/items/app_settings')) return { data: nonRapThreshold ? [{ setting_value: nonRapThreshold }] : [] };
		return { data: [] };
	})
}));
vi.mock('./approvalSubmit', () => ({
	createApprovalRequest: vi.fn(async (p: any) => {
		calls.push({ url: 'approval', method: 'APPROVAL', body: JSON.stringify(p) });
		if (approvalFails) throw new Error('engine down');
		return { id: 'req-1' };
	})
}));
vi.mock('./masterPengajuanSubmit', () => ({ createMasterPengajuanEntry: vi.fn(async () => ({})) }));
vi.mock('./gates/plDisiplinFieldGates', () => ({ evaluateFieldPLGatesWithDisiplin: vi.fn(async () => ({ blocking: [], gates: [], overridden: [] })) }));
vi.mock('./gates/plFieldOverride', () => ({ recordFieldGateOverride: vi.fn() }));
vi.mock('./packingListSubmit', () => ({ resolvePackingModuleKey: vi.fn(async (amt: number) => (amt >= 50_000_000 ? 'packing_list.project.direktur' : 'packing_list.project')) }));

import { createPackingItemsRequest } from './packingListCreateItems';

const base = { projectId: 7, requesterId: 3, pic: 'Leader A', projectName: 'Proyek X' };
const items = [
	{ material_name: 'Cat A', qty: 2, unit: 'Kg', unit_price: 100_000 },
	{ material_name: 'Kuas', qty: 10, unit: 'Pcs', unit_price: 0 }
];

describe('createPackingItemsRequest (PRJ-11)', () => {
	beforeEach(() => {
		calls.length = 0;
		approvalFails = false;
		nonRapThreshold = null;
		templateRows = [];
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	it('satu batch POST (array), unit_price & planned_amount dari estimasi, nominal approval = Σ qty×estimasi', async () => {
		const r = await createPackingItemsRequest({ ...base, items });
		const posts = calls.filter((c) => c.method === 'POST' && c.url === '/items/project_budgets');
		expect(posts).toHaveLength(1);
		const rows = JSON.parse(posts[0].body!);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ unit_price: 100_000, planned_amount: 200_000 });
		const appr = JSON.parse(calls.find((c) => c.method === 'APPROVAL')!.body!);
		expect(appr.amount).toBe(200_000);
		expect(appr.summary).toContain('2 barang di luar RAP');
		expect(appr.summary).toContain('1 belum diberi estimasi harga');
		expect(r.approvalRequestId).toBe('req-1');
	});

	it('approval gagal -> baris baru DIHAPUS (rollback) dan error dilempar, bukan diabaikan', async () => {
		approvalFails = true;
		await expect(createPackingItemsRequest({ ...base, items })).rejects.toThrow(/tidak ada data yang tersimpan/i);
		const del = calls.find((c) => c.method === 'DELETE');
		expect(del).toBeTruthy();
		expect(JSON.parse(del!.body!)).toEqual([500, 501]);
	});

	it('ambang pl_non_rap_direktur_above -> tier Direktur walau tier normal lebih rendah', async () => {
		nonRapThreshold = '150000';
		await createPackingItemsRequest({ ...base, items });
		const appr = JSON.parse(calls.find((c) => c.method === 'APPROVAL')!.body!);
		expect(appr.moduleKey).toBe('packing_list.project.direktur');
	});

	it('item template dengan material_name kosong otomatis menggunakan description', async () => {
		const templateItems = [
			{ material_name: '', description: 'MASKER BIASA', qty: 5, unit: 'Pcs' },
			{ material_name: '', description: 'SARUNG TANGAN', qty: 2, unit: 'Lusin' }
		];
		const r = await createPackingItemsRequest({ ...base, items: templateItems as any });
		const posts = calls.filter((c) => c.method === 'POST' && c.url === '/items/project_budgets');
		expect(posts).toHaveLength(1);
		const rows = JSON.parse(posts[0].body!);
		expect(rows).toHaveLength(2);
		expect(rows[0].material_name).toBe('MASKER BIASA');
		expect(rows[1].material_name).toBe('SARUNG TANGAN');
		expect(r.itemIds).toEqual([500, 501]);
	});

	it('item template: tautan & flag dibaca dari baris template di server dan ikut tersimpan', async () => {
		templateRows = [
			{ id: 11183, identitas_barang_id: 17122, no_item_needed: 0, is_manpower: 0 },
			{ id: 825, identitas_barang_id: null, no_item_needed: 1, is_manpower: 0 }
		];
		await createPackingItemsRequest({
			...base,
			items: [
				{ material_name: 'EPOXY PRIMER', qty: 2, unit: 'Kg', template_item_id: 11183 },
				{ material_name: 'SPIKE ROLL', qty: 1, unit: 'Pcs', template_item_id: 825 }
			]
		});
		const rows = JSON.parse(calls.find((c) => c.method === 'POST' && c.url === '/items/project_budgets')!.body!);
		expect(rows[0].identitas_barang_id).toBe(17122);
		expect(rows[0].no_item_needed).toBeUndefined();
		expect(rows[1].identitas_barang_id).toBeUndefined();
		expect(rows[1].no_item_needed).toBe(true);
		expect(rows[0].template_item_id).toBeUndefined();
	});

	it('flag no_item_needed kiriman klien dibuang', async () => {
		await createPackingItemsRequest({ ...base, items: [{ material_name: 'KUAS', qty: 1, unit: 'Pcs', no_item_needed: true } as any] });
		const rows = JSON.parse(calls.find((c) => c.method === 'POST' && c.url === '/items/project_budgets')!.body!);
		expect(rows[0].no_item_needed).toBeUndefined();
	});

	it('usul_baru tanpa tautan -> usulan tercatat di identitas_barang_usulan_baru', async () => {
		const r = await createPackingItemsRequest({
			...base,
			items: [{ material_name: 'BARANG BARU X', qty: 2, unit: 'Pcs', budget_category: 'packing_consumable', usul_baru: true, usul_catatan: 'spek A' }]
		});
		const post = calls.find((c) => c.method === 'POST' && c.url === '/items/identitas_barang_usulan_baru');
		expect(post).toBeTruthy();
		const body = JSON.parse(post!.body!);
		expect(body[0]).toMatchObject({ project_budget_id: 500, usulan_nama: 'BARANG BARU X', usulan_satuan: 'Pcs', status: 'menunggu', catatan: 'spek A' });
		expect(r.usulanCount).toBe(1);
	});

	it('usul_baru diabaikan bila barang sudah tertaut katalog', async () => {
		await createPackingItemsRequest({ ...base, items: [{ material_name: 'KUAS', qty: 1, unit: 'Pcs', identitas_barang_id: 55, usul_baru: true }] });
		expect(calls.some((c) => c.url === '/items/identitas_barang_usulan_baru')).toBe(false);
	});

	it('item manual dari katalog menyimpan identitas_barang_id', async () => {
		await createPackingItemsRequest({ ...base, items: [{ material_name: 'KUAS', qty: 1, unit: 'Pcs', identitas_barang_id: 55 }] });
		const rows = JSON.parse(calls.find((c) => c.method === 'POST' && c.url === '/items/project_budgets')!.body!);
		expect(rows[0].identitas_barang_id).toBe(55);
	});
});
