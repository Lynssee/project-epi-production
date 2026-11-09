import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ directus: vi.fn(), blind: vi.fn() }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => h.directus(...a) }));
vi.mock('$lib/server/kioskAlert', () => ({ triggerN8nInventoryAlert: vi.fn() }));
vi.mock('$lib/server/gateDefinitionsMode', () => ({ resolveGateMode: vi.fn() }));

vi.mock('$lib/server/opnameSesi', () => ({ itemBlindKiosk: (...a: any[]) => h.blind(...a) }));

import { fetchRakDetail, fetchSubRak } from './kioskStok';

const anak = (id: number, nama: string, is_active: unknown = 1) => ({
	id,
	kode_gudang: `BK-${id}`,
	nama_gudang: nama,
	jenis: 'slot',
	is_active
});

describe('fetchRakDetail — stok tersedia', () => {
	const rakPath = async (path: string) => {
		if (path.startsWith('/items/gudang/91')) return { data: { id: 91, nama_gudang: 'RAK A8', parent_gudang_id: null, pic_karyawan_ids: [] } };
		if (path.startsWith('/items/gudang_item_placement?filter[gudang_id][_eq]'))
			return { data: [{ id: 1, identitas_barang_id: 10 }, { id: 2, identitas_barang_id: 11 }, { id: 3, identitas_barang_id: 12 }] };
		if (path.startsWith('/items/identitas_barang'))
			return { data: [{ id: 10, stok_tersedia: '76.401' }, { id: 11, stok_tersedia: '0,25' }, { id: 12, stok_tersedia: null }] };
		return { data: [] };
	};
	beforeEach(() => {
		h.directus.mockReset();
		h.blind.mockReset();
		h.directus.mockImplementation(rakPath);
	});

	it('mengubah varchar jadi angka; kosong tetap null, bukan 0', async () => {
		h.blind.mockResolvedValue(new Set());
		const detail = await fetchRakDetail(91);
		expect(detail!.placements.map((p) => p.stok_tersedia)).toEqual([76.401, 0.25, null]);
	});

	it('barang dalam sesi blind tidak mengirim stok ke kiosk', async () => {
		h.blind.mockResolvedValue(new Set([10]));
		const detail = await fetchRakDetail(91);
		expect(detail!.placements[0]).toMatchObject({ stok_tersedia: null, blind_sesi: true });
		expect(detail!.placements[1].stok_tersedia).toBe(0.25);
	});
});

describe('fetchSubRak', () => {
	beforeEach(() => {
		h.directus.mockReset();
	});

	it('urut alami, buang yang nonaktif, gabungkan jumlah item', async () => {
		h.directus.mockImplementation(async (path: string) =>
			path.startsWith('/items/gudang?')
				? { data: [anak(3, 'RAK A10'), anak(1, 'RAK A2'), anak(2, 'RAK A9', 0), anak(4, 'RAK A1', false)] }
				: { data: [{ gudang_id: 3, count: { id: '5' } }] }
		);

		const hasil = await fetchSubRak(147);

		expect(hasil.map((r) => r.nama_gudang)).toEqual(['RAK A2', 'RAK A10']);
		expect(hasil.map((r) => r.jumlah_item)).toEqual([0, 5]);
		expect(h.directus).toHaveBeenCalledTimes(2);
	});

	it('tanpa anak aktif: tidak menjalankan query agregat', async () => {
		h.directus.mockResolvedValue({ data: [] });

		expect(await fetchSubRak(147)).toEqual([]);
		expect(h.directus).toHaveBeenCalledTimes(1);
	});

	it('hitungan gagal: daftar tetap tampil dengan jumlah null, bukan 0', async () => {
		h.directus.mockImplementation(async (path: string) => {
			if (path.startsWith('/items/gudang?')) return { data: [anak(1, 'RAK A1')] };
			throw new Error('directus down');
		});

		const hasil = await fetchSubRak(147);

		expect(hasil).toHaveLength(1);
		expect(hasil[0].jumlah_item).toBeNull();
	});
});
