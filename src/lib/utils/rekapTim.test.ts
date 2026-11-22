import { describe, it, expect } from 'vitest';
import { buildRekapTim, monthRange } from './rekapTim';

const roster = [
	{ manpowerId: 1, nama: 'Budi', jabatan: 'Painter' },
	{ manpowerId: 2, nama: 'Andi', jabatan: 'Blaster' },
	{ manpowerId: 3, nama: 'Citra', jabatan: 'Helper' }
];

describe('buildRekapTim', () => {
	it('hitung hadir% (hadir/setengah_hari/Stand-by = hadir) dan rata-rata bintang', () => {
		const { baris, ringkas } = buildRekapTim(
			roster,
			[
				{ manpower_id: 1, status: 'hadir' }, { manpower_id: 1, status: 'Stand-by' }, { manpower_id: 1, status: 'alpa' }, { manpower_id: 1, status: 'setengah_hari' },
				{ manpower_id: 2, status: 'hadir' }
			],
			[{ manpower_id: 1, kualitas: 5, safety: 4, ketepatan: 3 }, { manpower_id: 2, kualitas: 2, safety: 2, ketepatan: 2 }]
		);
		const budi = baris.find((b) => b.manpowerId === 1)!;
		expect(budi).toMatchObject({ hadir: 3, totalAbsensi: 4, hadirPct: 75, rataNilai: 4, belumDinilai: false });
		expect(ringkas).toMatchObject({ totalPekerja: 3, belumDinilai: 1, rataNilai: 3, hadirPctRata: 88 });
	});

	it('belum dinilai / tanpa absensi = null (bukan 0) dan ditandai perhatian', () => {
		const { baris } = buildRekapTim(roster, [], []);
		for (const b of baris) {
			expect(b.rataNilai).toBeNull();
			expect(b.hadirPct).toBeNull();
			expect(b.perhatian).toEqual(['Belum dinilai bulan ini']);
		}
	});

	it('nilai rendah & kehadiran rendah masuk perhatian; yang bermasalah diurut ke atas', () => {
		const { baris, ringkas } = buildRekapTim(
			roster,
			[{ manpower_id: 2, status: 'alpa' }, { manpower_id: 2, status: 'hadir' }, { manpower_id: 1, status: 'hadir' }],
			[{ manpower_id: 2, kualitas: 2, safety: 3, ketepatan: 2 }, { manpower_id: 1, kualitas: 5, safety: 5, ketepatan: 5 }, { manpower_id: 3, kualitas: 4, safety: 4, ketepatan: 4 }]
		);
		expect(baris[0].nama).toBe('Andi');
		expect(baris[0].perhatian).toEqual(['Nilai rendah (2.3★)', 'Kehadiran 50%']);
		expect(ringkas.perluPerhatian).toBe(1);
	});

	it('abaikan bintang di luar 1–5 dan roster kosong', () => {
		const { baris } = buildRekapTim(roster, [], [{ manpower_id: 1, kualitas: 0, safety: 9, ketepatan: NaN as any }]);
		expect(baris.find((b) => b.manpowerId === 1)!.belumDinilai).toBe(true);
		expect(buildRekapTim([], [], []).ringkas).toMatchObject({ totalPekerja: 0, rataNilai: null, hadirPctRata: null });
	});
});

describe('monthRange', () => {
	it('rentang bulan termasuk Februari kabisat; format salah = null', () => {
		expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
		expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
		expect(monthRange('2026-13')).toBeNull();
		expect(monthRange('')).toBeNull();
	});
});
