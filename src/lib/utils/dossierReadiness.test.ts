import { describe, it, expect } from 'vitest';
import { requiredDays, coverage, levelFor, buildDossierReadiness } from './dossierReadiness';

describe('requiredDays', () => {
	it('7 hari terakhir sebelum hari ini, tanpa Minggu, hari ini tidak dihitung', () => {
		// 2026-11-10 = Selasa; jendela 3–9 Nov; 8 Nov = Minggu dibuang
		expect(requiredDays({ todayYmd: '2026-11-10', windowDays: 7, offWeekdays: [0] })).toEqual([
			'2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-09'
		]);
	});
	it('tidak lebih awal dari tanggal mulai proyek; input rusak -> aman', () => {
		expect(requiredDays({ todayYmd: '2026-11-10', windowDays: 7, offWeekdays: [0], startYmd: '2026-11-06' })).toEqual(['2026-11-06', '2026-11-07', '2026-11-09']);
		expect(requiredDays({ todayYmd: 'x', windowDays: 7 })).toEqual([]);
		expect(requiredDays({ todayYmd: '2026-11-10', windowDays: 999, offWeekdays: [] }).length).toBe(31);
	});
});

describe('coverage & levelFor', () => {
	it('menghitung hari yang belum terpenuhi', () => {
		const c = coverage(['a', 'b', 'c', 'd'], ['a', 'c', 'zzz']);
		expect(c).toEqual({ done: 2, total: 4, pct: 50, missing: ['b', 'd'] });
		expect(coverage([], []).pct).toBeNull();
	});
	it('ambang dari setelan', () => {
		expect(levelFor(95)).toBe('ok');
		expect(levelFor(70)).toBe('warn');
		expect(levelFor(10)).toBe('bad');
		expect(levelFor(null)).toBe('na');
		expect(levelFor(80, { okPct: 80, warnPct: 50 })).toBe('ok');
	});
});

describe('buildDossierReadiness', () => {
	const days = ['d1', 'd2', 'd3', 'd4'];
	it('semua lengkap -> 100% hijau', () => {
		const r = buildDossierReadiness({
			days, absensiDates: days, absensiMenunggu: 0, reportDates: days,
			qcRequiredDays: ['d1', 'd2'], qcDoneDays: ['d1', 'd2'], lpj: { belum: 0, overdue: 0 },
			pendingGr: 0, docsRequired: 5, docsMissing: 0
		});
		expect(r.items).toHaveLength(6);
		expect(r.overallPct).toBe(100);
		expect(r.overallLevel).toBe('ok');
		expect(r.items.every((i) => i.level === 'ok')).toBe(true);
	});
	it('log bolong & GR tertahan menurunkan skor; item tak terukur tidak ikut rata-rata', () => {
		const r = buildDossierReadiness({ days, absensiDates: days, absensiMenunggu: 0, reportDates: ['d1', 'd2'], pendingGr: 2, docsRequired: 0, docsMissing: 0 });
		const log = r.items.find((i) => i.id === 'log_harian')!;
		expect(log.pct).toBe(50);
		expect(log.missingDays).toEqual(['d3', 'd4']);
		expect(r.items.find((i) => i.id === 'surat_jalan')!.level).toBe('bad');
		expect(r.items.find((i) => i.id === 'dokumen')!.level).toBe('na');
		expect(r.overallPct).toBe(Math.round((100 + 50 + 0) / 3));
	});
	it('presensi menunggu verifikasi menurunkan hijau menjadi kuning', () => {
		const r = buildDossierReadiness({ days, absensiDates: days, absensiMenunggu: 3, reportDates: days, pendingGr: 0, docsRequired: 1, docsMissing: 0 });
		const p = r.items.find((i) => i.id === 'presensi')!;
		expect(p.level).toBe('warn');
		expect(p.detail).toContain('3 presensi menunggu verifikasi');
	});
	it('sumber GAGAL dimuat -> tak terukur, BUKAN lengkap', () => {
		const r = buildDossierReadiness({ days, absensiDates: null, absensiUnavailable: true, absensiMenunggu: 0, reportDates: null, pendingGr: null, docsRequired: null, docsMissing: null });
		expect(r.items.every((i) => i.level === 'na' && i.pct === null)).toBe(true);
		expect(r.overallPct).toBeNull();
		expect(r.items[0].detail).toContain('belum dapat dimuat');
	});
	it('QC ambient: cakupan hari wajib; tanpa hari wajib -> tak berlaku; sumber gagal -> tak terukur', () => {
		const base = { days, absensiDates: days, absensiMenunggu: 0, reportDates: days, pendingGr: 0, docsRequired: 0, docsMissing: 0 };
		const qc = (i: any) => buildDossierReadiness({ ...base, ...i }).items.find((x) => x.id === 'qc')!;
		expect(qc({ qcRequiredDays: ['d1', 'd2', 'd3', 'd4'], qcDoneDays: ['d1', 'd2'] })).toMatchObject({ pct: 50, level: 'bad', missingDays: ['d3', 'd4'] });
		expect(qc({ qcRequiredDays: [], qcDoneDays: [] })).toMatchObject({ pct: null, level: 'na' });
		expect(qc({ qcRequiredDays: null })).toMatchObject({ pct: null, level: 'na' });
		expect(qc({ qcRequiredDays: null }).detail).toContain('belum dapat dimuat');
	});
	it('LPJ: 0 belum = hijau; belum dalam tenggang = kuning; lewat tenggang = merah; gagal = tak terukur', () => {
		const base = { days, absensiDates: days, absensiMenunggu: 0, reportDates: days, pendingGr: 0, docsRequired: 0, docsMissing: 0 };
		const lpj = (l: any) => buildDossierReadiness({ ...base, lpj: l }).items.find((x) => x.id === 'lpj')!;
		expect(lpj({ belum: 0, overdue: 0 })).toMatchObject({ pct: 100, level: 'ok' });
		expect(lpj({ belum: 2, overdue: 0 })).toMatchObject({ pct: 50, level: 'warn' });
		const late = lpj({ belum: 2, overdue: 1 });
		expect(late).toMatchObject({ pct: 0, level: 'bad' });
		expect(late.detail).toContain('1 lewat masa tenggang');
		expect(lpj(null)).toMatchObject({ pct: null, level: 'na' });
		expect(lpj(undefined)).toMatchObject({ pct: null, level: 'na' });
	});
	it('urutan indikator: presensi, log, QC, surat jalan, LPJ, dokumen', () => {
		const r = buildDossierReadiness({ days, absensiDates: days, absensiMenunggu: 0, reportDates: days, pendingGr: 0, docsRequired: 0, docsMissing: 0 });
		expect(r.items.map((i) => i.id)).toEqual(['presensi', 'log_harian', 'qc', 'surat_jalan', 'lpj', 'dokumen']);
	});
	it('proyek tanpa tim -> presensi tidak berlaku (bukan 0%)', () => {
		const r = buildDossierReadiness({ days, absensiDates: null, absensiMenunggu: 0, reportDates: days, pendingGr: 0, docsRequired: 0, docsMissing: 0 });
		expect(r.items[0]).toMatchObject({ id: 'presensi', level: 'na', pct: null });
		expect(r.overallPct).toBe(100);
	});
});
