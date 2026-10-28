// Gate PL lapangan: status proyek tidak aktif (termasuk cancelled) & penanganan error lookup.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { evaluateFieldPLGates, evaluateFieldPLGatesFor, type FieldPLRow } from './plFieldGates';

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

