import { describe, it, expect } from 'vitest';
import { computeIdleLoans, parseReportTools } from './idleLoans';

const now = new Date('2026-10-20T03:00:00Z');
const loan = (id: number, name: string, code: string | null, start: string) => ({ id, start_date: start, equipment: { name, code } });
const loans = [
	loan(1, 'SPRAYGUN AIRLESS CHINA', 'ASET/EPI/EQU/SPR/0004', '2026-10-07'),
	loan(2, 'KOMPRESOR DIESEL 185 CFM', 'ASET/EPI/EQU/KOM/0002', '2026-10-01')
];

describe('parseReportTools', () => {
	it('string JSON, array string, array objek, dan teks biasa', () => {
		expect(parseReportTools('["Spraygun Airless"]')).toEqual(['spraygun airless']);
		expect(parseReportTools(['Kompresor', { name: 'Genset 5KVA', code: 'GS-1' }])).toEqual(['kompresor', 'genset 5kva', 'gs 1']);
		expect(parseReportTools('kompresor')).toEqual(['kompresor']);
		expect(parseReportTools(null)).toEqual([]);
		expect(parseReportTools('')).toEqual([]);
	});
});

describe('computeIdleLoans — alat menganggur', () => {
	it('alat tak pernah disebut di laporan → menganggur sejak dipinjam', () => {
		const r = computeIdleLoans({ loans, reports: [{ date: '2026-10-18', tools: ['Genset'] }], idleDays: 5, now });
		expect(r.map((x) => x.name)).toEqual(['KOMPRESOR DIESEL 185 CFM', 'SPRAYGUN AIRLESS CHINA']); // 19 hari, 13 hari
		expect(r[0]).toMatchObject({ idle_days: 19, basis: 'sejak_dipinjam', last_used: null });
	});

	it('alat disebut di laporan terakhir → hitung dari tanggal itu; yang baru dipakai tidak ditandai', () => {
		const reports = [
			{ date: '2026-10-10', tools: ['Spraygun Airless China'] },
			{ date: '2026-10-19', tools: [{ name: 'KOMPRESOR DIESEL 185 CFM' }] }
		];
		const r = computeIdleLoans({ loans, reports, idleDays: 5, now });
		expect(r).toHaveLength(1);
		expect(r[0]).toMatchObject({ name: 'SPRAYGUN AIRLESS CHINA', idle_days: 10, last_used: '2026-10-10', basis: 'laporan_terakhir' });
	});

	it('cocok lewat kode alat; ambang dari setelan; ambang ≤ 0 / tak valid menonaktifkan fitur', () => {
		const reports = [{ date: '2026-10-19', tools: [{ code: 'ASET/EPI/EQU/SPR/0004' }] }];
		expect(computeIdleLoans({ loans: [loans[0]], reports, idleDays: 5, now })).toEqual([]);
		expect(computeIdleLoans({ loans, reports: [], idleDays: 0, now })).toEqual([]);
		expect(computeIdleLoans({ loans, reports: [], idleDays: NaN, now })).toEqual([]);
		expect(computeIdleLoans({ loans, reports: [], idleDays: 30, now })).toEqual([]); // belum melewati ambang 30 hari
	});

	it('pemakaian sebelum tanggal pinjam diabaikan; tanggal pinjam rusak → tidak ditebak; input kosong aman', () => {
		const reports = [{ date: '2026-09-01', tools: ['Spraygun Airless China'] }];
		const r = computeIdleLoans({ loans: [loans[0]], reports, idleDays: 5, now });
		expect(r[0]).toMatchObject({ basis: 'sejak_dipinjam', idle_days: 13 });
		expect(computeIdleLoans({ loans: [loan(9, 'GENSET', null, 'rusak')], reports: [], idleDays: 1, now })).toEqual([]);
		expect(computeIdleLoans({ idleDays: 5 })).toEqual([]);
	});
});
