import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
let objects: any[] = [];
let charters: any[] = [{ id: 11 }, { id: 12 }];
let failObjects = false;

vi.mock('./secureDirectus', () => ({
	secureDirectusJson: vi.fn(async (url: string) => {
		calls.push(url);
		if (url.startsWith('/items/project_charters')) return { data: charters };
		if (url.startsWith('/items/project_objects')) {
			if (failObjects) throw new Error('403 FORBIDDEN');
			return { data: objects };
		}
		return { data: [] };
	})
}));

const { fetchProjectObjectSpecs } = await import('./projectSpecApi');

beforeEach(() => { calls.length = 0; objects = []; charters = [{ id: 11 }, { id: 12 }]; failObjects = false; });

describe('fetchProjectObjectSpecs', () => {
	it('mengambil charter lalu objek TERPISAH (tanpa filter bersarang) dan field eksplisit', async () => {
		await fetchProjectObjectSpecs(7);
		expect(calls).toHaveLength(2);
		expect(calls[0]).toContain('/items/project_charters');
		expect(decodeURIComponent(calls[0])).toContain('"project_id":{"_eq":7}');
		expect(decodeURIComponent(calls[1])).toContain('"project_charter_id":{"_in":[11,12]}');
		expect(calls[1]).toContain('spesifikasi_teknis');
		expect(calls.join(' ')).not.toContain('project_charter_id.project_id');
	});

	it('proyek tanpa charter → [] tanpa query objek', async () => {
		charters = [];
		expect(await fetchProjectObjectSpecs(7)).toEqual([]);
		expect(calls).toHaveLength(1);
	});

	it('memetakan spesifikasi: lapisan bertarget, total, pengecualian, foto objek/uuid', async () => {
		objects = [
			{ id: 1, tipe: 'besi', nama_objek: 'Rangka', qty: 4, satuan: 'Pcs', foto_identitas: { id: 'f1' },
				spesifikasi_teknis: { sistem_lapisan: [{ tahap: 'Primer', target_micron: 75 }, { target_micron: null }, { tahap: 'Top', target_micron: 60 }] } },
			{ id: 2, tipe: 'lantai', nama_area: 'Gudang A', luas: 100, foto_identitas: 'f2', spesifikasi_teknis: JSON.stringify({ pengecualian_alasan: 'Hanya grinding, tanpa cat' }) },
			{ id: 3, tipe: 'besi', spesifikasi_teknis: null }
		];
		const r = await fetchProjectObjectSpecs('7');
		expect(r[0]).toMatchObject({ nama: 'Rangka', totalMicron: 135, foto_identitas: 'f1' });
		expect(r[0].layers.map((l) => l.no)).toEqual([1, 3]);
		expect(r[1]).toMatchObject({ nama: 'Gudang A', pengecualian: 'Hanya grinding, tanpa cat', foto_identitas: 'f2', layers: [] });
		expect(r[2]).toMatchObject({ nama: 'Objek #3', spec: null, totalMicron: 0 });
	});

	it('gagal baca objek dilempar (tidak ditelan diam-diam)', async () => {
		failObjects = true;
		await expect(fetchProjectObjectSpecs(7)).rejects.toThrow('403');
	});
});
