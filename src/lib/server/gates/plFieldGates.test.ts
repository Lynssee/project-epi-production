// Gate PL lapangan: status proyek tidak aktif (termasuk cancelled) & penanganan error lookup.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { evaluateFieldPLGates, evaluateFieldPLGatesFor, loadTemplateFlags, type FieldPLRow } from './plFieldGates';

const row = (over: Partial<FieldPLRow> = {}): FieldPLRow => ({ id: 1, project_id: 10, qty: 1, identitas_barang_id: 1, ...over });
const ctx = (status: string | null | undefined, rows = [row()]) => ({
	rows,
	projectStatusById: new Map<string, string | null | undefined>([['10', status]]),
	stockById: new Map<string, number>()
});
const gate = (r: ReturnType<typeof evaluateFieldPLGates>, key: string) => r.gates.find((g) => g.gate_key === key);

afterEach(() => vi.restoreAllMocks());

describe('G_PKL_PROJECT — status proyek tidak aktif', () => {
	it.each(['selesai', 'closed', 'cancelled', 'CANCELLED'])('proyek "%s" memblokir pengajuan baru', (st) => {
		const r = evaluateFieldPLGates(ctx(st));
		expect(r.blocking).toContain('G_PKL_PROJECT');
		expect(gate(r, 'G_PKL_PROJECT')?.message).toContain('tidak aktif');
	});

	it.each(['on progress', 'waiting', 'hold', 'prepare', 'draft', 'repair'])('proyek "%s" lolos', (st) => {
		const r = evaluateFieldPLGates(ctx(st));
		expect(r.blocking).toEqual([]);
		expect(gate(r, 'G_PKL_PROJECT')?.status).toBe('passed');
	});

	it('proyek cancelled + override (super admin/GM) -> tidak memblokir, ditandai overridden', () => {
		const r = evaluateFieldPLGates(ctx('cancelled'), { overrideAllowed: true });
		expect(r.blocking).toEqual([]);
		expect(r.overridden).toContain('G_PKL_PROJECT');
	});

	it('proyek tidak ditemukan di map -> memblokir (perilaku lama dipertahankan)', () => {
		const r = evaluateFieldPLGates(ctx(undefined));
		expect(r.blocking).toContain('G_PKL_PROJECT');
		expect(gate(r, 'G_PKL_PROJECT')?.message).toContain('tidak ditemukan');
	});
});

describe('evaluateFieldPLGatesFor — error lookup tidak ditelan', () => {
	it('gagal ambil status proyek -> melempar error jujur (bukan "proyek tidak ditemukan")', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetcher = vi.fn(async (path: string) => {
			if (path.startsWith('/items/projects')) throw new Error('HTTP 403');
			return { data: [] };
		});
		await expect(evaluateFieldPLGatesFor([row()], fetcher)).rejects.toThrow(/Gagal memverifikasi status proyek.*HTTP 403/s);
		expect(spy).toHaveBeenCalled();
	});

	it('gagal ambil stok -> tetap selesai, stok dilewati, error dilog', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetcher = vi.fn(async (path: string) => {
			if (path.startsWith('/items/identitas_barang')) throw new Error('timeout');
			return { data: [{ id: 10, status: 'on progress' }] };
		});
		const r = await evaluateFieldPLGatesFor([row({ identitas_barang_id: 5, qty: 100 })], fetcher);
		expect(r.blocking).toEqual([]);
		expect(r.warnings).not.toContain('G_PKL_STOK');
		expect(spy).toHaveBeenCalled();
	});

	it('lookup sukses: proyek cancelled diblokir lewat jalur penuh', async () => {
		const fetcher = vi.fn(async () => ({ data: [{ id: 10, status: 'cancelled' }] }));
		const r = await evaluateFieldPLGatesFor([row()], fetcher);
		expect(r.blocking).toContain('G_PKL_PROJECT');
	});
});

describe('G_PKL_CAT_WARNA — spesifikasi warna cat', () => {
	it('item cat tanpa warna memblokir pengajuan', () => {
		const r = evaluateFieldPLGates(ctx('on progress', [
			row({ material_name: 'FOXA 955', material_color: '' })
		]));
		expect(r.blocking).toContain('G_PKL_CAT_WARNA');
		expect(gate(r, 'G_PKL_CAT_WARNA')?.status).toBe('failed');
		expect(gate(r, 'G_PKL_CAT_WARNA')?.message).toContain('spesifikasi warna');
	});

	it('item cat dengan warna "-" dianggap kosong dan memblokir', () => {
		const r = evaluateFieldPLGates(ctx('on progress', [
			row({ material_name: 'FOXAFLOOR CLEAR : OX - 9251', material_color: '-' })
		]));
		expect(r.blocking).toContain('G_PKL_CAT_WARNA');
	});

	it('item cat dengan warna valid ("Clear / Bening" / "RAL 7035") lolos', () => {
		const r = evaluateFieldPLGates(ctx('on progress', [
			row({ material_name: 'FOXAFLOOR CLEAR : OX - 9251', material_color: 'Clear / Bening' }),
			row({ material_name: 'FOXA 955', material_color: 'RAL 7035' })
		]));
		expect(r.blocking).toEqual([]);
		expect(gate(r, 'G_PKL_CAT_WARNA')?.status).toBe('passed');
	});

	it('item non-cat exempt (THINNER, KUAS, TALC) tanpa warna lolos', () => {
		const r = evaluateFieldPLGates(ctx('on progress', [
			row({ material_name: 'THINNER CUCI', material_color: '' }),
			row({ material_name: 'KUAS ROLLER 4 INCH', material_color: '-' }),
			row({ material_name: 'TALC POWDER', material_color: '' })
		]));
		expect(r.blocking).toEqual([]);
		expect(gate(r, 'G_PKL_CAT_WARNA')?.status).toBe('passed');
	});

	it('item cat tanpa warna dengan override super admin/GM -> lolos dengan overridden', () => {
		const r = evaluateFieldPLGates(ctx('on progress', [
			row({ material_name: 'FOXA 955', material_color: '' })
		], ), { overrideAllowed: true });
		expect(r.blocking).toEqual([]);
		expect(r.overridden).toContain('G_PKL_CAT_WARNA');
		expect(gate(r, 'G_PKL_CAT_WARNA')?.status).toBe('failed');
	});
});


describe('mode gate mengikuti Kalibrasi Gate', () => {
	const unlinked = row({ id: 7, identitas_barang_id: null, material_name: 'THINNER CUCI' });
	const paint = row({ material_name: 'FOXA 955', material_color: '' });
	const withModes = (modes: any, rows: FieldPLRow[]) => ({ ...ctx('on progress', rows), modes });

	it('G_PKL_INVENTORY_LINK shadow -> tidak tampil, tidak memblokir, tercatat di shadowed', () => {
		const r = evaluateFieldPLGates(withModes({ G_PKL_INVENTORY_LINK: 'shadow' }, [unlinked]));
		expect(r.blocking).toEqual([]);
		expect(r.warnings).toEqual([]);
		expect(gate(r, 'G_PKL_INVENTORY_LINK')).toBeUndefined();
		expect(r.shadowed).toContain('G_PKL_INVENTORY_LINK');
	});

	it.each(['soft', 'warn'])('G_PKL_INVENTORY_LINK %s -> peringatan, tetap terkirim', (mode) => {
		const r = evaluateFieldPLGates(withModes({ G_PKL_INVENTORY_LINK: mode }, [unlinked]));
		expect(r.blocking).toEqual([]);
		expect(r.warnings).toContain('G_PKL_INVENTORY_LINK');
		expect(gate(r, 'G_PKL_INVENTORY_LINK')?.severity).toBe('SEMI');
		expect(gate(r, 'G_PKL_INVENTORY_LINK')?.affected_items).toEqual([{ id: 7, label: 'THINNER CUCI' }]);
	});

	it('G_PKL_INVENTORY_LINK hard -> memblokir; override super admin/GM -> peringatan overridden', () => {
		expect(evaluateFieldPLGates(withModes({ G_PKL_INVENTORY_LINK: 'hard' }, [unlinked])).blocking).toContain('G_PKL_INVENTORY_LINK');
		const r = evaluateFieldPLGates(withModes({ G_PKL_INVENTORY_LINK: 'hard' }, [unlinked]), { overrideAllowed: true });
		expect(r.blocking).toEqual([]);
		expect(r.overridden).toContain('G_PKL_INVENTORY_LINK');
	});

	it('G_PKL_CAT_WARNA shadow -> tidak memblokir', () => {
		const r = evaluateFieldPLGates(withModes({ G_PKL_CAT_WARNA: 'shadow' }, [paint]));
		expect(r.blocking).toEqual([]);
		expect(r.shadowed).toContain('G_PKL_CAT_WARNA');
	});

	it('G_PKL_PROJECT soft -> proyek tidak aktif jadi peringatan', () => {
		const r = evaluateFieldPLGates({ ...ctx('cancelled'), modes: { G_PKL_PROJECT: 'soft' } });
		expect(r.blocking).toEqual([]);
		expect(r.warnings).toContain('G_PKL_PROJECT');
	});

	it('G_PKL_STOK hard tetap peringatan; shadow tidak tampil', () => {
		const rows = [row({ identitas_barang_id: 5, qty: 100 })];
		const base = { ...ctx('on progress', rows), stockById: new Map([['5', 1]]) };
		const hard = evaluateFieldPLGates({ ...base, modes: { G_PKL_STOK: 'hard' } });
		expect(hard.blocking).toEqual([]);
		expect(hard.warnings).toContain('G_PKL_STOK');
		const shadow = evaluateFieldPLGates({ ...base, modes: { G_PKL_STOK: 'shadow' } });
		expect(shadow.warnings).toEqual([]);
		expect(shadow.shadowed).toContain('G_PKL_STOK');
	});

	it('evaluateFieldPLGatesFor membaca mode lewat resolveMode', async () => {
		const fetcher = vi.fn(async () => ({ data: [{ id: 10, status: 'on progress' }] }));
		const resolveMode = vi.fn(async () => 'shadow' as const);
		const r = await evaluateFieldPLGatesFor([unlinked], fetcher, { resolveMode });
		// 4 gate lama + G_PKL_MASTER_PRICE + 3 gate rasionalitas qty = FIELD_PL_GATE_KEYS.length
		expect(resolveMode).toHaveBeenCalledTimes(8);
		expect(r.blocking).toEqual([]);
	});
});

describe('G_PKL_INVENTORY_LINK — baris non-barang dikecualikan', () => {
	const strict = (rows: FieldPLRow[]) => evaluateFieldPLGates({ ...ctx('on progress', rows), modes: { G_PKL_INVENTORY_LINK: 'hard' } });

	it.each([
		['no_item_needed', { no_item_needed: true }],
		['is_manpower', { is_manpower: true }],
		['no_item_needed = 1 dari Directus', { no_item_needed: 1 as any }],
		['kategori jasa', { budget_category: 'jasa' }],
		['kategori packing_jasa', { budget_category: 'packing_jasa' }],
		['kategori packing_lain_lain', { budget_category: 'packing_lain_lain' }]
	])('%s lolos', (_label, over) => {
		expect(strict([row({ identitas_barang_id: null, ...over })]).blocking).toEqual([]);
	});

	it('kategori packing_consumable tanpa tautan tetap dinilai', () => {
		expect(strict([row({ identitas_barang_id: null, budget_category: 'packing_consumable' })]).blocking).toContain('G_PKL_INVENTORY_LINK');
	});
});

describe('G_PKL_INVENTORY_LINK — usulan barang baru', () => {
	const hard = (rows: FieldPLRow[], allowProposal: boolean) =>
		evaluateFieldPLGates({ ...ctx('on progress', rows), modes: { G_PKL_INVENTORY_LINK: 'hard' }, allowProposal });
	const proposed = row({ identitas_barang_id: null, usul_baru: true, material_name: 'BARANG BARU' });

	it('mode hard + allowProposal -> baris ber-usulan lolos', () => {
		expect(hard([proposed], true).blocking).toEqual([]);
	});
	it('allowProposal dimatikan di pengaturan gate -> tetap memblokir', () => {
		expect(hard([proposed], false).blocking).toContain('G_PKL_INVENTORY_LINK');
	});
	it('baris tanpa tautan dan tanpa usulan tetap memblokir walau allowProposal aktif', () => {
		expect(hard([row({ identitas_barang_id: null })], true).blocking).toContain('G_PKL_INVENTORY_LINK');
	});
});

describe('loadTemplateFlags', () => {
	it('membaca tautan & flag dari baris is_template, tanpa query bila tak ada id', async () => {
		const fetcher = vi.fn(async () => ({ data: [{ id: 11183, identitas_barang_id: 17122, no_item_needed: 0, is_manpower: 0 }, { id: 825, identitas_barang_id: null, no_item_needed: 1, is_manpower: 0 }] }));
		const map = await loadTemplateFlags([11183, 825, null], fetcher);
		expect(String(fetcher.mock.calls[0]).includes('filter[is_template][_eq]=true')).toBe(true);
		expect(map.get(11183)).toEqual({ identitas_barang_id: 17122, no_item_needed: false, is_manpower: false });
		expect(map.get(825)?.no_item_needed).toBe(true);

		const none = vi.fn();
		expect((await loadTemplateFlags([null, undefined], none)).size).toBe(0);
		expect(none).not.toHaveBeenCalled();
	});

	it('gagal baca -> dilog dan peta kosong', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const map = await loadTemplateFlags([1], vi.fn(async () => { throw new Error('HTTP 403'); }));
		expect(map.size).toBe(0);
		expect(spy).toHaveBeenCalled();
	});
});

describe('G_PKL_MASTER_PRICE — harga master/RAB (hanya peringatan dari lapangan)', () => {
	const priced = (rows: FieldPLRow[], prices: Array<[string, number]>, extra: any = {}) =>
		evaluateFieldPLGates({ ...ctx('on progress', rows), priceById: new Map(prices), ...extra });
	const mp = (r: ReturnType<typeof evaluateFieldPLGates>) => r.gates.find((g) => g.gate_key === 'G_PKL_MASTER_PRICE');

	it('barang bertaut master tanpa harga → peringatan, tidak memblokir (APAR #21801)', () => {
		const r = priced([row({ identitas_barang_id: 21801, material_name: 'APAR' })], [['21801', 0]]);
		expect(r.warnings).toContain('G_PKL_MASTER_PRICE');
		expect(r.blocking).toEqual([]);
		expect(mp(r)?.status).toBe('failed');
		expect(mp(r)?.message).toContain('APAR');
		expect(mp(r)?.message).toContain('tetap bisa dikirim');
	});

	it('mode hard dari Kalibrasi Gate TETAP hanya peringatan di lapangan (harga = tanggung jawab Admin)', () => {
		const r = priced([row({ identitas_barang_id: 21801, material_name: 'APAR' })], [['21801', 0]], { modes: { G_PKL_MASTER_PRICE: 'hard' } });
		expect(r.blocking).toEqual([]);
		expect(r.warnings).toContain('G_PKL_MASTER_PRICE');
	});

	it('shadow → tidak tampil, tercatat di shadowed', () => {
		const r = priced([row({ identitas_barang_id: 21801 })], [['21801', 0]], { modes: { G_PKL_MASTER_PRICE: 'shadow' } });
		expect(r.warnings).not.toContain('G_PKL_MASTER_PRICE');
		expect(r.shadowed).toContain('G_PKL_MASTER_PRICE');
	});

	it('lulus bila master berharga atau harga RAB terisi', () => {
		expect(mp(priced([row({ identitas_barang_id: 6 })], [['6', 239038]]))?.status).toBe('passed');
		expect(mp(priced([row({ identitas_barang_id: 21801, unit_price: 285000 })], [['21801', 0]]))?.status).toBe('passed');
		expect(mp(priced([row({ identitas_barang_id: 21801, planned_amount: 570000, qty: 2 })], [['21801', 0]]))?.status).toBe('passed');
	});

	it('alat, non-barang, non-katalog, dan harga tak dimuat tidak dinilai', () => {
		const eq = priced([row({ identitas_barang_id: 19898 })], [['19898', 0]], { equipmentById: new Set(['19898']) });
		expect(mp(eq)).toBeUndefined();
		expect(mp(priced([row({ identitas_barang_id: 1, is_manpower: true })], [['1', 0]]))).toBeUndefined();
		expect(mp(priced([row({ identitas_barang_id: null })], []))).toBeUndefined();
		expect(mp(evaluateFieldPLGates(ctx('on progress', [row({ identitas_barang_id: 21801 })])))).toBeUndefined(); // priceById tak dimuat
	});

	it('evaluateFieldPLGatesFor: harga dari query stok yang sama; respons tanpa kolom harga / lookup gagal = tidak dinilai', async () => {
		const mk = (stock: any[] | Error) => vi.fn(async (path: string) => {
			if (path.includes('/items/projects')) return { data: [{ id: 10, status: 'on progress' }] };
			if (stock instanceof Error) throw stock;
			return { data: stock };
		});
		const withPrice = await evaluateFieldPLGatesFor([row({ identitas_barang_id: 21801, material_name: 'APAR' })], mk([{ id: 21801, stok_tersedia: 5, avg_cost: null, harga_beli: 0, harga: null, is_borrowable: false, id_equipment: null }]));
		expect(withPrice.warnings).toContain('G_PKL_MASTER_PRICE');
		const noCols = await evaluateFieldPLGatesFor([row({ identitas_barang_id: 21801 })], mk([{ id: 21801, stok_tersedia: 5 }]));
		expect(noCols.gates.find((g) => g.gate_key === 'G_PKL_MASTER_PRICE')).toBeUndefined();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const failed = await evaluateFieldPLGatesFor([row({ identitas_barang_id: 21801 })], mk(new Error('boom')));
		expect(failed.gates.find((g) => g.gate_key === 'G_PKL_MASTER_PRICE')).toBeUndefined();
	});
});
