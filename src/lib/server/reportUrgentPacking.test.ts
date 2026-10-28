// Pengganti Flow B: pemilihan kebutuhan urgent + pengajuan lewat jalur server (idempoten, ber-otorisasi).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./directus', () => ({ directusServerJson: vi.fn() }));
vi.mock('./packingListCreateItems', () => ({ createPackingItemsRequest: vi.fn() }));

import {
	pickUrgentNeeds,
	createUrgentPackingFromReport,
	refOf,
	MAX_URGENT_ITEMS,
	MAX_URGENT_QTY,
	type Deps
} from './reportUrgentPacking';

const need = (over: Record<string, any> = {}) => ({
	type: 'SARUNG TANGAN KAIN',
	amount: 20,
	unit: 'Lusin',
	notes: '',
	urgency: 'urgent',
	identitas_barang_id: null,
	...over
});

describe('pickUrgentNeeds', () => {
	it('hanya memilih urgent; normal diabaikan tanpa dicatat sebagai skip', () => {
		const r = pickUrgentNeeds([need(), need({ urgency: 'normal' })], 7);
		expect(r.items).toHaveLength(1);
		expect(r.skipped).toEqual([]);
		expect(r.items[0]).toMatchObject({ material_name: 'SARUNG TANGAN KAIN', qty: 20, unit: 'Lusin', identitas_barang_id: null });
		expect(r.items[0].note).toContain('Laporan Harian #7');
		expect(r.items[0].note).toContain(refOf(7, 0));
	});

	it('item urgent TANPA tautan barang tetap diajukan (Flow B lama membuangnya diam-diam)', () => {
		expect(pickUrgentNeeds([need({ identitas_barang_id: null })], 1).items).toHaveLength(1);
	});

	it('meneruskan identitas_barang_id yang valid', () => {
		expect(pickUrgentNeeds([need({ identitas_barang_id: 16145 })], 1).items[0].identitas_barang_id).toBe(16145);
	});

	it.each([
		[0, 'qty_tidak_valid'],
		[-5, 'qty_tidak_valid'],
		['abc', 'qty_tidak_valid'],
		[null, 'qty_tidak_valid'],
		[MAX_URGENT_QTY + 1, 'qty_tidak_wajar']
	])('qty %s -> skip %s (Flow B lama menerima 0/negatif)', (amount, reason) => {
		const r = pickUrgentNeeds([need({ amount })], 1);
		expect(r.items).toEqual([]);
		expect(r.skipped).toEqual([{ index: 0, reason }]);
	});

	it('tanpa nama -> skip; unit kosong -> pcs; qty string numerik diterima', () => {
		expect(pickUrgentNeeds([need({ type: '  ', description: '' })], 1).skipped[0].reason).toBe('tanpa_nama');
		const ok = pickUrgentNeeds([need({ unit: '', amount: '3' })], 1).items[0];
		expect(ok.unit).toBe('pcs');
		expect(ok.qty).toBe(3);
	});

	it('material_needs berupa string JSON, null, atau rusak tidak melempar', () => {
		expect(pickUrgentNeeds(JSON.stringify([need()]), 1).items).toHaveLength(1);
		expect(pickUrgentNeeds(null, 1).items).toEqual([]);
		expect(pickUrgentNeeds('{bukan json', 1).items).toEqual([]);
		expect(pickUrgentNeeds([null, 'x', 5], 1).skipped.map((s) => s.reason)).toEqual(['bukan_objek', 'bukan_objek', 'bukan_objek']);
	});

	it(`dibatasi ${MAX_URGENT_ITEMS} item; sisanya melebihi_batas`, () => {
		const r = pickUrgentNeeds(Array.from({ length: MAX_URGENT_ITEMS + 3 }, (_, i) => need({ type: `B${i}` })), 1);
		expect(r.items).toHaveLength(MAX_URGENT_ITEMS);
		expect(r.skipped.filter((s) => s.reason === 'melebihi_batas')).toHaveLength(3);
	});

	it('penanda ref unik per indeks dan ":1}" tidak cocok dengan ":10}"', () => {
		expect(refOf(5, 10).includes(refOf(5, 1))).toBe(false);
		expect(refOf(5, 1)).not.toBe(refOf(5, 2));
	});
});

const actor = { karyawanId: 42, nama: 'Budi', divisi: 'PROJECT', firebaseUid: 'fb1', overrideAllowed: false };
const report = (over: Record<string, any> = {}) => ({
	id: 3411,
	project_id: 978,
	karyawan_id: 42,
	status: 'submitted',
	material_needs: [need()],
	...over
});

function mkDeps(rep: any, existingNotes: string[] = []) {
	const directus = vi.fn(async (path: string) => {
		if (path.startsWith('/items/reports/')) return { data: rep };
		if (path.startsWith('/items/project_budgets')) return { data: existingNotes.map((note, i) => ({ id: i + 1, note })) };
		throw new Error('path tak terduga: ' + path);
	});
	const create = vi.fn(async (input: any) => ({ itemIds: input.items.map((_: any, i: number) => 900 + i), approvalRequestId: 'req-1' }));
	return { deps: { directus, create } as unknown as Deps, directus, create };
}

describe('createUrgentPackingFromReport', () => {
	beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));

	it('jalur sukses: memanggil createPackingItemsRequest dengan proyek, pengaju, dan note ber-ref', async () => {
		const { deps, create } = mkDeps(report());
		const r = await createUrgentPackingFromReport(3411, actor, deps);
		expect(r).toMatchObject({ created: 1, approvalRequestId: 'req-1' });
		const arg = create.mock.calls[0][0];
		expect(arg).toMatchObject({ projectId: 978, requesterId: 42, pic: 'Budi', departmentKey: 'PROJECT', firebaseUid: 'fb1', overrideAllowed: false });
		expect(arg.items[0].note).toContain(refOf(3411, 0));
		expect(arg.items[0]).not.toHaveProperty('_ref');
		expect(arg.items[0]).not.toHaveProperty('_index');
	});

	it('idempoten: item yang ref-nya sudah ada di project_budgets.note tidak dibuat lagi', async () => {
		const { deps, create } = mkDeps(report(), [`Auto-generated dari Laporan Harian #3411 (kebutuhan urgent) ${refOf(3411, 0)}`]);
		const r = await createUrgentPackingFromReport(3411, actor, deps);
		expect(create).not.toHaveBeenCalled();
		expect(r).toMatchObject({ created: 0, reason: 'semua_sudah_diajukan' });
		expect(r.skipped).toEqual([{ index: 0, reason: 'sudah_diajukan' }]);
	});

	it('sebagian sudah diajukan: hanya yang baru dikirim', async () => {
		const rep = report({ material_needs: [need({ type: 'A' }), need({ type: 'B' })] });
		const { deps, create } = mkDeps(rep, [`x ${refOf(3411, 0)}`]);
		const r = await createUrgentPackingFromReport(3411, actor, deps);
		expect(create.mock.calls[0][0].items.map((i: any) => i.material_name)).toEqual(['B']);
		expect(r.created).toBe(1);
	});

	it('bukan pengirim laporan -> ditolak, tidak membuat apa pun', async () => {
		const { deps, create } = mkDeps(report({ karyawan_id: 99 }));
		const r = await createUrgentPackingFromReport(3411, actor, deps);
		expect(r).toMatchObject({ created: 0, reason: 'bukan_pengirim_laporan' });
		expect(create).not.toHaveBeenCalled();
	});

	it('laporan lama tanpa karyawan_id -> tidak diproses (tidak bisa dibuktikan pengirimnya)', async () => {
		const { deps, create } = mkDeps(report({ karyawan_id: null }));
		expect(await createUrgentPackingFromReport(3411, actor, deps)).toMatchObject({ created: 0, reason: 'laporan_tanpa_pengirim' });
		expect(create).not.toHaveBeenCalled();
	});

	it.each([
		[null, 'laporan_tidak_ditemukan'],
		[report({ status: 'rejected' }), 'laporan_ditolak'],
		[report({ project_id: null }), 'proyek_tidak_valid'],
		[report({ material_needs: [need({ urgency: 'normal' })] }), 'tidak_ada_kebutuhan_urgent']
	])('kasus penolakan -> %#', async (rep, reason) => {
		const { deps, create } = mkDeps(rep);
		expect(await createUrgentPackingFromReport(3411, actor, deps)).toMatchObject({ created: 0, reason });
		expect(create).not.toHaveBeenCalled();
	});

	it('gate/approval gagal (mis. proyek closed) -> tidak melempar, error dikembalikan', async () => {
		const { deps, create } = mkDeps(report());
		create.mockRejectedValueOnce(new Error('Pengajuan packing list belum bisa dikirim:\n• Tautan & status proyek: proyek #978 berstatus "cancelled"'));
		const r = await createUrgentPackingFromReport(3411, actor, deps);
		expect(r.created).toBe(0);
		expect(r.error).toContain('cancelled');
	});

	it('error baca Directus tidak melempar ke pemanggil dan dilog', async () => {
		const deps = { directus: vi.fn(async () => { throw new Error('HTTP 403'); }), create: vi.fn() } as unknown as Deps;
		const r = await createUrgentPackingFromReport(3411, actor, deps);
		expect(r).toMatchObject({ created: 0, error: 'HTTP 403' });
		expect(console.error).toHaveBeenCalled();
	});
});
