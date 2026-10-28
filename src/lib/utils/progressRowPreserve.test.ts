import { describe, it, expect } from 'vitest';
import { rowUiVolume, rowExtra, applyRowExtra } from './progressRowPreserve';

// Baris nyata form admin (laporan 3557 project 1051): volume 35 m² di stages, persen 10.3 di progress_value.
const adminRow = {
	subtask_id: 'sub_1', activity: 'SANDBLASTING', progress_value: 10.3, unit: 'm²', notes: '-',
	category: 'External under button tanki', target_volume: 340, stages: { pekerjaan: 35 }
};
const fieldRow = {
	subtask_id: 'sub_1', activity: 'SANDBLASTING', progress_value: 111.7, unit: 'm²', notes: 'x',
	category: 'External under button tanki', target_volume: 340, service_type: 'sandblasting',
	foto_bukti: [], executor_type: null, readiness_checklist: []
};

describe('rowUiVolume', () => {
	it('baris admin: volume dari stages.pekerjaan, bukan persen', () => {
		expect(rowUiVolume(adminRow)).toBe(35);
	});
	it('baris lapangan: progress_value apa adanya', () => {
		expect(rowUiVolume(fieldRow)).toBe(111.7);
	});
	it('stages.pekerjaan 0 tetap 0 (volume nol eksplisit)', () => {
		expect(rowUiVolume({ progress_value: 50, stages: { pekerjaan: 0 } })).toBe(0);
	});
	it('null / ngawur -> 0', () => {
		expect(rowUiVolume(null)).toBe(0);
		expect(rowUiVolume({ progress_value: 'abc' })).toBe(0);
	});
});

describe('rowExtra', () => {
	it('mengumpulkan field asing (stages, subtask_name, jam_*), bukan field milik UI', () => {
		expect(rowExtra({ ...adminRow, subtask_name: 'S', jam_mulai: '08:00' })).toEqual({
			stages: { pekerjaan: 35 }, subtask_name: 'S', jam_mulai: '08:00'
		});
	});
	it('baris lapangan murni -> kosong', () => {
		expect(rowExtra(fieldRow)).toEqual({});
		expect(rowExtra(undefined)).toEqual({});
	});
});

describe('applyRowExtra (round-trip)', () => {
	const toClean = (r: any, volume: number) => ({
		subtask_id: r.subtask_id, activity: r.activity, progress_value: volume, unit: r.unit, notes: r.notes,
		category: r.category, target_volume: r.target_volume, service_type: ''
	});

	it('buka-simpan tanpa ubah angka: baris admin identik (stages & persen utuh)', () => {
		const vol = rowUiVolume(adminRow);
		const saved = applyRowExtra(toClean(adminRow, vol), rowExtra(adminRow));
		expect(saved.stages).toEqual({ pekerjaan: 35 });
		expect(saved.progress_value).toBe(10.3); // 35/340*100 = 10.29 -> 10.3
	});

	it('user mengubah volume di form lapangan: stages & persen ikut konsisten', () => {
		const saved = applyRowExtra(toClean(adminRow, 68), rowExtra(adminRow));
		expect(saved.stages).toEqual({ pekerjaan: 68 });
		expect(saved.progress_value).toBe(20);
	});

	it('TANPA perbaikan: persen 10.3 akan terbaca volume 10.3 — dengan perbaikan volume tetap 35', () => {
		expect(rowUiVolume(adminRow)).not.toBe(adminRow.progress_value);
	});

	it('baris lapangan murni tidak berubah', () => {
		const clean = toClean(fieldRow, 111.7);
		expect(applyRowExtra(clean, rowExtra(fieldRow))).toBe(clean);
		expect(applyRowExtra(clean, undefined)).toBe(clean);
	});

	it('field asing dipertahankan; field milik UI menang bila bentrok', () => {
		const row = { ...fieldRow, subtask_name: 'Nama lama', jam_mulai: '08:00' };
		const saved = applyRowExtra({ ...toClean(row, 5), notes: 'baru' }, rowExtra(row));
		expect(saved.subtask_name).toBe('Nama lama');
		expect(saved.jam_mulai).toBe('08:00');
		expect(saved.notes).toBe('baru');
		expect(saved.stages).toBeUndefined();
	});

	it('target 0 pada baris ber-stages: stages diperbarui, progress_value tak dipaksa jadi persen', () => {
		const r = { ...adminRow, target_volume: 0 };
		const saved = applyRowExtra(toClean(r, 12), rowExtra(r));
		expect(saved.stages).toEqual({ pekerjaan: 12 });
		expect(saved.progress_value).toBe(12);
	});
});
