import { describe, it, expect } from 'vitest';
import { SJ_LANES, groupSjByLane } from '$lib/utils/sjBoardLanes';

describe('sjBoardLanes', () => {
	it('tiap tahap muncul di paling banyak satu lajur; tahap selesai tak punya lajur', () => {
		const all = SJ_LANES.flatMap((l) => l.stages);
		expect(new Set(all).size).toBe(all.length);
		for (const done of ['diterima', 'dokumen_kembali', 'tutup']) expect(all).not.toContain(done);
	});
	it('mengelompokkan per lajur & mengabaikan SJ selesai / tahap tak dikenal / tanpa tahap', () => {
		const items = [
			{ id: 1, stage: 'draft' }, { id: 2, stage: 'disiapkan' }, { id: 3, stage: 'lolos_gerbang' }, { id: 4, stage: 'dalam_perjalanan' },
			{ id: 5, stage: 'tiba_lokasi' }, { id: 6, stage: 'selisih' }, { id: 7, stage: 'diterima' }, { id: 8, stage: 'tutup' }, { id: 9, stage: 'ngawur' }, { id: 10 }
		];
		const g = Object.fromEntries(groupSjByLane(items).map((l) => [l.key, l.rows.map((r) => r.id)]));
		expect(g).toEqual({ siap: [1, 2], muat: [3], jalan: [4], tiba: [5], selisih: [6] });
	});
	it('null/undefined → semua lajur kosong, tidak melempar', () => {
		expect(groupSjByLane(null).every((l) => l.rows.length === 0)).toBe(true);
		expect(groupSjByLane(undefined)).toHaveLength(SJ_LANES.length);
	});
});
