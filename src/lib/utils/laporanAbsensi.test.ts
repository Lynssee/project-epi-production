import { describe, expect, it } from 'vitest';
import { rosterToRows, buildPoSplit, derivePoManpower, countHadir, attendanceStats, unallocatedHadir, toSubmitRows, type AttendanceRow } from './laporanAbsensi';

const roster = [
	{ tipe: 'leader' as const, rosterId: 1, nama: 'PANJI', jabatan: 'Project Leader' },
	{ tipe: 'manpower' as const, rosterId: 5, nama: 'KARSA', jabatan: 'HELPER' },
	{ tipe: 'manpower' as const, rosterId: 6, nama: 'HENDRI', jabatan: 'BLASTER' }
];

describe('rosterToRows', () => {
	it('default semua Hadir, belum dialokasikan', () => {
		const rows = rosterToRows(roster);
		expect(rows.every((r) => r.status_hadir === 'hadir' && r.alokasi === 'none')).toBe(true);
		expect(countHadir(rows)).toBe(3);
	});
});

describe('buildPoSplit', () => {
	const hadir = (alokasi: AttendanceRow['alokasi']) => ({ status_hadir: 'hadir' as const, alokasi });
	it('satu PO = 100%; PO di luar yang dilaporkan diabaikan', () => {
		expect(buildPoSplit(hadir(904), [904, 905])).toEqual([{ po_id: 904, persentase: 100 }]);
		expect(buildPoSplit(hadir(999), [904])).toEqual([]);
	});
	it('bagi rata: total tepat 100 walau tak habis dibagi', () => {
		const s = buildPoSplit(hadir('split'), [1, 2, 3]);
		expect(s).toHaveLength(3);
		expect(Math.round(s.reduce((a, b) => a + b.persentase, 0) * 100) / 100).toBe(100);
		expect(buildPoSplit(hadir('split'), [1, 2])).toEqual([{ po_id: 1, persentase: 50 }, { po_id: 2, persentase: 50 }]);
	});
	it('tidak hadir / tidak dialokasikan → kosong', () => {
		expect(buildPoSplit({ status_hadir: 'sakit', alokasi: 904 }, [904])).toEqual([]);
		expect(buildPoSplit(hadir('none'), [904])).toEqual([]);
		expect(buildPoSplit(hadir('split'), [])).toEqual([]);
	});
});

describe('derivePoManpower & statistik', () => {
	it('jumlah orang per PO dari alokasi (yang tidak hadir tidak dihitung)', () => {
		const rows = rosterToRows(roster);
		rows[0].alokasi = 904;
		rows[1].alokasi = 'split';
		rows[2].status_hadir = 'absen'; rows[2].alokasi = 905;
		// 904: 1 + 0,5 = 1,5 → 2 ; 905: 0,5 → 1 (yang Alpha tidak dihitung)
		expect(derivePoManpower(rows, [904, 905])).toEqual({ 904: 2, 905: 1 });
	});
	it('statistik per status & orang hadir tanpa alokasi', () => {
		const rows = rosterToRows(roster);
		rows[1].status_hadir = 'ijin';
		rows[2].status_hadir = 'absen';
		expect(attendanceStats(rows)).toEqual({ total: 3, hadir: 1, ijin: 1, sakit: 0, absen: 1 });
		expect(unallocatedHadir(rows).map((r) => r.nama)).toEqual(['PANJI']);
	});
});

describe('toSubmitRows', () => {
	it('keterangan hanya untuk tidak hadir; manpower_id hanya untuk manpower; split terhitung', () => {
		const rows = rosterToRows(roster);
		rows[0].alokasi = 904; rows[0].keterangan = 'x';
		rows[1].status_hadir = 'sakit'; rows[1].keterangan = ' demam ';
		const out = toSubmitRows(rows, [904]);
		expect(out[0]).toMatchObject({ tipe: 'leader', manpower_id: null, keterangan: '', po_split: [{ po_id: 904, persentase: 100 }] });
		expect(out[1]).toMatchObject({ tipe: 'manpower', manpower_id: 5, status_hadir: 'sakit', keterangan: 'demam', po_split: [] });
	});
});
