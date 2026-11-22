import { describe, it, expect } from 'vitest';
import {
	addDaysYmd,
	diffDays,
	isoDay,
	toWibYmdLoose,
	buildDailyBreakdown,
	fillCalendarRange,
	buildComplianceCalendar,
	buildLpjAging,
	weekStartMonday,
	actualPctAt,
	buildWeeklyDeviation
} from './kendaliHarian';

describe('helper tanggal', () => {
	it('addDaysYmd / diffDays / isoDay', () => {
		expect(addDaysYmd('2026-11-01', -1)).toBe('2026-10-31');
		expect(diffDays('2026-11-01', '2026-11-10')).toBe(9);
		expect(isoDay('2026-11-10T05:00:00Z')).toBe('2026-11-10');
		expect(isoDay('-')).toBeNull();
		expect(isoDay(null)).toBeNull();
	});
	it('toWibYmdLoose: UTC malam → tanggal WIB berikutnya, tanggal polos apa adanya', () => {
		expect(toWibYmdLoose('2026-11-08T18:30:00.000Z')).toBe('2026-11-09');
		expect(toWibYmdLoose('2026-11-08')).toBe('2026-11-08');
		expect(toWibYmdLoose('garbage')).toBeNull();
		expect(toWibYmdLoose(null)).toBeNull();
	});
});

describe('buildDailyBreakdown & fillCalendarRange (pola kpiDrilldown)', () => {
	it('mengagregasi per hari, urut naik, running total, abaikan tanggal rusak', () => {
		const d = buildDailyBreakdown(['2026-11-03', '2026-11-01', '2026-11-03', 'x', null], { dateOf: (x) => x, amountOf: () => 2 });
		expect(d).toEqual([
			{ date: '2026-11-01', count: 1, nominal: 2, running_total: 2 },
			{ date: '2026-11-03', count: 2, nominal: 4, running_total: 6 }
		]);
		expect(buildDailyBreakdown(null)).toEqual([]);
	});
	it('fillCalendarRange mengisi hari kosong dan membawa running_total', () => {
		const d = buildDailyBreakdown(['2026-11-01', '2026-11-03'], { dateOf: (x) => x, amountOf: () => 1 });
		const c = fillCalendarRange(d, '2026-11-01', '2026-11-04');
		expect(c.map((x) => [x.date, x.count, x.running_total])).toEqual([
			['2026-11-01', 1, 1],
			['2026-11-02', 0, 1],
			['2026-11-03', 1, 2],
			['2026-11-04', 0, 2]
		]);
		expect(fillCalendarRange([], '2026-11-05', '2026-11-01')).toEqual([]);
		expect(fillCalendarRange([], 'x', '2026-11-01')).toEqual([]);
	});
});

describe('buildComplianceCalendar', () => {
	// 2026-11-12 = Kamis. Jendela 14 hari → 30 Okt (Jum) .. 12 Nov.
	const base = { todayYmd: '2026-11-12', windowDays: 14, offWeekdays: [0] };

	it('hijau/merah/libur/hari-ini-menunggu; hari ini tidak dihitung bolong', () => {
		const cal = buildComplianceCalendar({
			...base,
			reportDates: ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-11']
		})!;
		const flat = cal.weeks.flat().filter((c) => c.status !== 'pad');
		const by = Object.fromEntries(flat.map((c) => [c.date, c.status]));
		expect(by['2026-11-12']).toBe('today_pending');
		expect(by['2026-11-08']).toBe('off'); // Minggu
		expect(by['2026-11-10']).toBe('missed');
		expect(by['2026-11-07']).toBe('missed'); // Sabtu tidak libur
		expect(by['2026-11-11']).toBe('reported');
		expect(cal.missedDates).toContain('2026-11-10');
		expect(cal.todayReported).toBe(false);
		// streak berhenti di 10 Nov (bolong) → hanya 11 Nov
		expect(cal.currentStreak).toBe(1);
		expect(cal.pct).toBe(Math.round((cal.reported / cal.required) * 100));
	});

	it('susunan minggu Senin–Minggu dengan padding & 7 kolom', () => {
		const cal = buildComplianceCalendar({ ...base, reportDates: [] })!;
		for (const w of cal.weeks) expect(w.length).toBe(7);
		// 30 Okt = Jumat → 4 sel pad di depan (Sen..Kam)
		expect(cal.weeks[0].slice(0, 4).every((c) => c.status === 'pad')).toBe(true);
		expect(cal.weeks[0][4].date).toBe('2026-10-30');
	});

	it('tidak merah sebelum tanggal mulai proyek; proyek belum mulai → null', () => {
		const cal = buildComplianceCalendar({ ...base, startYmd: '2026-11-09', reportDates: ['2026-11-09'] })!;
		expect(cal.fromYmd).toBe('2026-11-09');
		expect(cal.missedDates).toEqual(['2026-11-10', '2026-11-11']);
		expect(buildComplianceCalendar({ ...base, startYmd: '2026-12-01', reportDates: [] })).toBeNull();
	});

	it('laporan pada hari libur tetap hijau tapi tidak menambah hari wajib', () => {
		const a = buildComplianceCalendar({ ...base, reportDates: [] })!;
		const b = buildComplianceCalendar({ ...base, reportDates: ['2026-11-08'] })!;
		expect(b.weeks.flat().find((c) => c.date === '2026-11-08')!.status).toBe('reported');
		expect(b.required).toBe(a.required);
		expect(b.reported).toBe(0);
	});

	it('bolong terpanjang & hari ini sudah lapor; input rusak aman', () => {
		const cal = buildComplianceCalendar({
			todayYmd: '2026-11-12', windowDays: 7, offWeekdays: [0],
			reportDates: ['2026-11-06', '2026-11-12', '2026-11-12']
		})!;
		expect(cal.todayReported).toBe(true);
		expect(cal.longestMissRun).toBe(4); // 7, 9, 10, 11 — Minggu 8 libur tidak memutus rangkaian
		expect(buildComplianceCalendar({ todayYmd: 'x', reportDates: [] })).toBeNull();
	});
});

describe('buildLpjAging', () => {
	it('urut dari yang terlama; lewat tenggang = bad; separuh tenggang = warn', () => {
		const a = buildLpjAging(
			[
				{ id: 1, nomor_pengajuan: 'PA-1', tujuan_pengajuan: 'Uang muka A', tanggal_dicairkan: '2026-11-11T02:00:00Z' },
				{ id: 2, nomor_pengajuan: 'PA-2', tanggal_dicairkan: '2026-10-20' },
				{ id: 3, tanggal_dicairkan: '2026-11-07' },
				{ id: 4, nomor_pengajuan: 'PA-4' }
			],
			'2026-11-12',
			7
		);
		expect(a.items.map((i) => i.id)).toEqual([2, 3, 1, 4]);
		expect(a.items[0]).toMatchObject({ ageDays: 23, overdue: true, level: 'bad' });
		expect(a.items[1]).toMatchObject({ ageDays: 5, overdue: false, level: 'warn', label: 'PA #3' });
		expect(a.items[2]).toMatchObject({ ageDays: 1, level: 'ok', subtitle: 'Uang muka A' });
		// tanggal cair kosong: tampil, tidak dituduh telat
		expect(a.items[3]).toMatchObject({ ageDays: null, overdue: false });
		expect(a).toMatchObject({ total: 4, overdue: 1, oldestDays: 23, level: 'bad' });
	});
	it('kosong / input rusak → level ok, tanpa crash', () => {
		expect(buildLpjAging(null, '2026-11-12')).toMatchObject({ total: 0, overdue: 0, oldestDays: null, level: 'ok' });
		expect(buildLpjAging([{ id: 1, tanggal_dicairkan: '2026-11-01' }], 'x').items[0].ageDays).toBeNull();
		expect(buildLpjAging([{ id: 1, tanggal_dicairkan: '2026-11-01' }], '2026-11-12', -3).items[0].ageDays).toBe(11);
	});
});

describe('Kurva S minggu berjalan', () => {
	// Rencana: 0% di 1 Nov → 50% di 15 Nov → 100% di 29 Nov (linear antar titik)
	const baseline = [
		{ d: '2026-11-01', p: 0 },
		{ d: '2026-11-15', p: 50 },
		{ d: '2026-11-29', p: 100 }
	];
	it('weekStartMonday', () => {
		expect(weekStartMonday('2026-11-12')).toBe('2026-11-09'); // Kamis
		expect(weekStartMonday('2026-11-15')).toBe('2026-11-09'); // Minggu
		expect(weekStartMonday('2026-11-09')).toBe('2026-11-09');
	});
	it('actualPctAt carry-forward, 0 sebelum titik pertama', () => {
		const s = [{ d: '2026-11-05', p: 10 }, { d: '2026-11-09', p: 22 }];
		expect(actualPctAt(s, '2026-11-04')).toBe(0);
		expect(actualPctAt(s, '2026-11-08')).toBe(10);
		expect(actualPctAt(s, '2026-11-12')).toBe(22);
		expect(actualPctAt(null, '2026-11-12')).toBe(0);
	});
	it('tertinggal: delta negatif, butuh pace per hari kerja tersisa', () => {
		const w = buildWeeklyDeviation({
			baseline, hasSubtasks: true, todayYmd: '2026-11-12', offWeekdays: [0],
			actual: [{ d: '2026-11-06', p: 20 }, { d: '2026-11-10', p: 24 }]
		});
		expect(w.status).toBe('ok');
		expect(w.weekStart).toBe('2026-11-09');
		expect(w.weekEnd).toBe('2026-11-15');
		// rencana: 8 Nov = 7*50/14 = 25 ; 12 Nov = 11*50/14 = 39.3 ; 15 Nov = 50
		expect(w.plannedStartPct).toBe(25);
		expect(w.plannedNowPct).toBe(39.3);
		expect(w.plannedEndPct).toBe(50);
		expect(w.actualStartPct).toBe(20);
		expect(w.actualNowPct).toBe(24);
		expect(w.plannedWeekPts).toBe(25);
		expect(w.actualWeekPts).toBe(4);
		expect(w.deltaPts).toBe(-15.3);
		expect(w.tone).toBe('behind');
		expect(w.remainingPts).toBe(26);
		expect(w.workdaysLeft).toBe(3); // Kam, Jum, Sab (Minggu libur)
		expect(w.neededPerDayPts).toBe(8.7);
	});
	it('di atas rencana: tidak ada pengejaran', () => {
		const w = buildWeeklyDeviation({
			baseline, hasSubtasks: true, todayYmd: '2026-11-12', offWeekdays: [0],
			actual: [{ d: '2026-11-11', p: 60 }]
		});
		expect(w.tone).toBe('ahead');
		expect(w.remainingPts).toBe(0);
		expect(w.neededPerDayPts).toBeNull();
	});
	it('hari Minggu libur: tak ada hari kerja tersisa → neededPerDay null', () => {
		const w = buildWeeklyDeviation({ baseline, hasSubtasks: true, todayYmd: '2026-11-15', offWeekdays: [0], actual: [] });
		expect(w.workdaysLeft).toBe(0);
		expect(w.neededPerDayPts).toBeNull();
		expect(w.actualNowPct).toBe(0);
	});
	it('alasan tidak tersedia dijelaskan, bukan 0 palsu', () => {
		expect(buildWeeklyDeviation({ baseline: null, hasSubtasks: true, todayYmd: '2026-11-12', actual: [] })).toMatchObject({ status: 'na', reason: 'no_baseline', actualNowPct: null });
		expect(buildWeeklyDeviation({ baseline, hasSubtasks: false, todayYmd: '2026-11-12', actual: [] })).toMatchObject({ status: 'na', reason: 'no_timeline' });
		expect(buildWeeklyDeviation({ baseline, hasSubtasks: true, todayYmd: 'x', actual: [] })).toMatchObject({ status: 'na', reason: 'bad_input' });
	});
});
