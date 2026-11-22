import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn(), directusServerFetch: vi.fn() }));
vi.mock('$lib/server/gateDefinitionsMode', () => ({ resolveGateMode: vi.fn(async () => 'soft') }));

const hub = await import('./equipmentHub');
const verify = await import('./equipmentVerify');

/** Directus palsu berbasis potongan path (yang pertama cocok menang). */
function fakeDx(routes: Array<[string, any]>) {
	const calls: string[] = [];
	const dx: any = vi.fn(async (path: string) => {
		calls.push(path);
		for (const [frag, val] of routes) if (decodeURIComponent(path).includes(frag)) return typeof val === 'function' ? val(path) : val;
		return { data: [] };
	});
	return { dx, calls };
}

const MOBIL_ITEM = { id: 21192, nama_barang_lengkap: 'MOBIL - L300', kode_item: null, satuan: 'UNIT', id_equipment: 'ASET/EPI/KDR/MOB/0005', nomor_polisi: 'B 9795 SCB', parent_category: 135 };
const EQ = { id: 'b203fd69', name: 'MOBIL - L300', code: 'ASET/EPI/KDR/MOB/0005', category_id: 'cat-1' };

describe('bridgeItemToEquipment', () => {
	it('stiker lama EPI:ITEM:21192 → equipment lewat id_equipment', async () => {
		const { dx } = fakeDx([['/items/identitas_barang/21192', { data: MOBIL_ITEM }], ['filter[code][_eq]=ASET/EPI/KDR/MOB/0005', { data: [EQ] }]]);
		const r = await hub.bridgeItemToEquipment(21192, dx);
		expect(r).toMatchObject({ kind: 'equipment', equipment: { code: 'ASET/EPI/KDR/MOB/0005' } });
	});
	it('fallback lewat equipment.identitas_barang_id bila id_equipment kosong', async () => {
		const { dx } = fakeDx([['/items/identitas_barang/5', { data: { ...MOBIL_ITEM, id: 5, id_equipment: null } }], ['filter[identitas_barang_id][_eq]=5', { data: [EQ] }]]);
		expect((await hub.bridgeItemToEquipment(5, dx)).kind).toBe('equipment');
	});
	it('fallback terakhir: kode EQ-<id> hasil pendaftaran otomatis', async () => {
		const { dx } = fakeDx([
			['/items/identitas_barang/6', { data: { ...MOBIL_ITEM, id: 6, id_equipment: null } }],
			['filter[code][_eq]=EQ-6', { data: [{ ...EQ, code: 'EQ-6' }] }]
		]);
		expect(await hub.bridgeItemToEquipment(6, dx)).toMatchObject({ kind: 'equipment', equipment: { code: 'EQ-6' } });
	});
	it('barang stok biasa → kind item dengan nama lengkap', async () => {
		const { dx } = fakeDx([['/items/identitas_barang/9', { data: { id: 9, nama_barang_lengkap: 'CAT PUTIH', kode_item: 'RM-9', satuan: 'KG', id_equipment: null, nomor_polisi: null, parent_category: 10 } }]]);
		const r = await hub.bridgeItemToEquipment(9, dx);
		expect(r).toMatchObject({ kind: 'item', item: { nama_barang_lengkap: 'CAT PUTIH' } });
	});
	it('barang tidak ada (Directus 404) → not_found; gangguan lain dilempar', async () => {
		const nf: any = vi.fn(async () => { throw new Error('Directus 404 not found'); });
		expect(await hub.bridgeItemToEquipment(1, nf)).toEqual({ kind: 'not_found' });
		const boom: any = vi.fn(async () => { throw new Error('ECONNRESET'); });
		await expect(hub.bridgeItemToEquipment(1, boom)).rejects.toThrow('ECONNRESET');
	});
});

describe('findVehicleByEquipment fallback', () => {
	const VEH = { id: 7, nomor_polisi: 'B 9795 SCB', merk: 'Mitsubishi', model: 'L300', jenis: 'Mobil', status: 'Tersedia', pemilik: 'perusahaan' };
	it('tanpa kode: perilaku lama (1 query)', async () => {
		const { dx, calls } = fakeDx([]);
		expect(await verify.findVehicleByEquipment('x', dx)).toBeNull();
		expect(calls).toHaveLength(1);
	});
	it('cocok lewat kode_aset', async () => {
		const { dx } = fakeDx([['filter[kode_aset][_eq]', { data: [VEH] }]]);
		expect(await verify.findVehicleByEquipment('x', dx, 'ASET/1')).toEqual(VEH);
	});
	it('cocok lewat nomor_polisi master barang', async () => {
		const { dx } = fakeDx([['/items/identitas_barang', { data: [{ nomor_polisi: 'B 9795 SCB' }] }], ['filter[nomor_polisi][_eq]=B+9795+SCB', { data: [VEH] }]]);
		expect(await verify.findVehicleByEquipment('x', dx, 'ASET/1')).toEqual(VEH);
	});
	it('tak ada kecocokan sama sekali → null (jatuh ke alat biasa)', async () => {
		const { dx } = fakeDx([]);
		expect(await verify.findVehicleByEquipment('x', dx, 'ASET/1')).toBeNull();
	});
});

describe('loadSummary / loadPurchase', () => {
	it('summary menyusun profil kendaraan, aksi, dan banner masa berlaku', async () => {
		const eq = { id: 'e1', code: 'ASET/1', name: 'L300', parent_category: 'KENDARAAN', category_id: 'c1', tax_expiry: '2020-01-01' };
		const { dx } = fakeDx([['/items/category', { data: [{ id: 'c1', name: 'Kendaraan Roda 4' }] }], ['/items/fleet_kendaraan', { data: [{ id: 7, nomor_polisi: 'B 1' }] }]]);
		const s = await hub.loadSummary(eq, (await import('./equipmentHubCore')).DEFAULT_HUB_SETTINGS, 'soft', dx, Date.parse('2026-11-14'));
		expect(s.kind).toBe('vehicle');
		expect(s.profile).toBe('kendaraan');
		expect(s.actions.map((a) => a.id)).toContain('booking');
		expect(s.expiry[0]).toMatchObject({ key: 'pajak', level: 'expired' });
		expect(s.hubOpensOnScan).toBe(true);
	});
	it('purchase menyensor nominal bila tidak berhak', async () => {
		const { dx } = fakeDx([
			['/items/purchase_order_supplier_items', { data: [{ id: 1, po_id: 3, item_name: 'Ban', quantity: 4, unit: 'pcs', unit_price: 900000, total_price: 3600000, received_qty: 4 }] }],
			['/items/purchase_orders_supplier', { data: [{ id: 3, po_number: 'PO-3', po_date: '2026-01-01', supplier_name: 'Toko Ban', status: 'Done' }] }]
		]);
		const r: any = await hub.loadPurchase({ id: 'e1', identitas_barang_id: 21192 }, false, dx);
		expect(r.purchases[0]).toMatchObject({ poNumber: 'PO-3', supplier: 'Toko Ban', quantity: 4, unitPrice: null, totalPrice: null });
		const ok: any = await hub.loadPurchase({ id: 'e1', identitas_barang_id: 21192 }, true, dx);
		expect(ok.purchases[0].totalPrice).toBe(3600000);
	});
	it('purchase tanpa identitas_barang_id → linked false', async () => {
		const { dx } = fakeDx([]);
		expect((await hub.loadPurchase({ id: 'e1' }, true, dx) as any).linked).toBe(false);
	});
});

describe('loadSpareparts', () => {
	it('menggabungkan log pemakaian dengan master sparepart dan menyensor harga', async () => {
		const { dx } = fakeDx([
			['/items/sparepart_usage_log', { data: [{ id: 'u1', tanggal: '2026-10-01', work_order_id: 'w1', sparepart_id: 's1', jumlah: 2 }] }],
			['/items/sparepart?', { data: [{ id: 's1', code: 'SP-1', name: 'Filter Oli', brand: 'Sakura', last_price: 85000 }] }]
		]);
		const hidden = await hub.loadSpareparts('e1', false, dx);
		expect(hidden[0]).toMatchObject({ name: 'Filter Oli', jumlah: 2, code: 'SP-1', lastPrice: null });
		expect((await hub.loadSpareparts('e1', true, dx))[0].lastPrice).toBe(85000);
	});
});

describe('loadPelatihan (QR equipment → modul)', () => {
	it('tanpa identitas_barang_id → kosong tanpa memanggil Directus', async () => {
		const { dx } = fakeDx([]);
		expect((await hub.loadPelatihan({ id: 'e1' }, dx)).programs).toEqual([]);
		expect(dx).not.toHaveBeenCalled();
	});
	it('profil model (group) + profil unit digabung, hanya program published, tanpa duplikat', async () => {
		const { dx } = fakeDx([
			['/items/identitas_barang', { data: [{ id: 5, item_group_id: 'g-1' }] }],
			['/items/inventory_knowledge_profile', { data: [
				{ id: 1, item_id: null, group_id: 'g-1', training_program_id: 120, wajib_training: true },
				{ id: 2, item_id: 5, group_id: null, training_program_id: 120, wajib_training: false },
				{ id: 3, item_id: null, group_id: 'g-1', training_program_id: 999, wajib_training: false }
			] }],
			['/items/training_program', { data: [{ id: 120, judul: 'A3 — Troubleshoot Kompresor' }] }]
		]);
		const r = await hub.loadPelatihan({ id: 'e1', identitas_barang_id: 5 }, dx);
		expect(r.programs).toEqual([{ id: 120, judul: 'A3 — Troubleshoot Kompresor', sumber: 'model', wajib: true }]);
	});
	it('tanpa profil bertaut → kosong', async () => {
		const { dx } = fakeDx([['/items/identitas_barang', { data: [{ id: 5, item_group_id: null }] }]]);
		expect((await hub.loadPelatihan({ id: 'e1', identitas_barang_id: 5 }, dx)).programs).toEqual([]);
	});
});
