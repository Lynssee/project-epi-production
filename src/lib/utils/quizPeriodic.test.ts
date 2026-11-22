import { describe, it, expect } from 'vitest';
import {
	isPeriodicQuiz,
	isQuizWindowActive,
	isGateWindowActive,
	daysUntilStart,
	quizTargetScope,
	sampleQuestionIds,
	quizSampleSeed,
	resolveQuizPeriodState,
	decideQuizGate,
	parseEscapePaths,
	isEscapePath,
	parseIdList,
	DEFAULT_ESCAPE_PATHS
} from './quizPeriodic';

const NOW = new Date('2026-11-16T08:00:00Z').getTime();

describe('isPeriodicQuiz', () => {
	it('wajib-gate atau berulang = periodik', () => {
		expect(isPeriodicQuiz({ is_mandatory_gate: true, recurrence_type: 'once' })).toBe(true);
		expect(isPeriodicQuiz({ is_mandatory_gate: false, recurrence_type: 'weekly' })).toBe(true);
		expect(isPeriodicQuiz({ is_mandatory_gate: false, recurrence_type: 'once' })).toBe(false);
		expect(isPeriodicQuiz({ is_mandatory_gate: null, recurrence_type: null })).toBe(false);
		expect(isPeriodicQuiz(null)).toBe(false);
	});
});

describe('jendela periode', () => {
	it('window aktif / belum / lewat', () => {
		expect(isQuizWindowActive({ tanggal_mulai: '2026-11-16T00:00:00Z', tanggal_selesai: '2026-11-17T00:00:00Z' }, NOW)).toBe(true);
		expect(isQuizWindowActive({ tanggal_mulai: '2026-11-17T00:00:00Z', tanggal_selesai: null }, NOW)).toBe(false);
		expect(isQuizWindowActive({ tanggal_mulai: null, tanggal_selesai: '2026-11-15T00:00:00Z' }, NOW)).toBe(false);
		expect(isQuizWindowActive({ tanggal_mulai: null, tanggal_selesai: null }, NOW)).toBe(true);
	});
	it('gate butuh tanggal_mulai eksplisit', () => {
		expect(isGateWindowActive({ tanggal_mulai: null, tanggal_selesai: null }, NOW)).toBe(false);
		expect(isGateWindowActive({ tanggal_mulai: '2026-11-16T00:00:00Z', tanggal_selesai: null }, NOW)).toBe(true);
	});
	it('daysUntilStart membulat ke atas, null bila sudah mulai', () => {
		expect(daysUntilStart({ tanggal_mulai: '2026-11-23T08:00:00Z' }, NOW)).toBe(7);
		expect(daysUntilStart({ tanggal_mulai: '2026-11-23T09:00:00Z' }, NOW)).toBe(8);
		expect(daysUntilStart({ tanggal_mulai: '2026-11-16T00:00:00Z' }, NOW)).toBeNull();
	});
});

describe('target peserta', () => {
	const k = { id: 5, divisi_id: 2 };
	it('karyawan spesifik menang atas divisi', () => {
		expect(quizTargetScope({ target_karyawan_ids: [5], target_divisi_ids: [9] }, k)).toBe('targeted');
		expect(quizTargetScope({ target_karyawan_ids: [6], target_divisi_ids: [2] }, k)).toBe('not_targeted');
	});
	it('divisi dan fallback program', () => {
		expect(quizTargetScope({ target_karyawan_ids: null, target_divisi_ids: [2, 3] }, k)).toBe('targeted');
		expect(quizTargetScope({ target_karyawan_ids: [], target_divisi_ids: [3] }, k)).toBe('not_targeted');
		expect(quizTargetScope({ target_karyawan_ids: null, target_divisi_ids: null }, k)).toBe('program');
		expect(quizTargetScope({ target_karyawan_ids: null, target_divisi_ids: [2] }, { id: 5, divisi_id: null })).toBe('not_targeted');
	});
	it('parseIdList toleran', () => {
		expect(parseIdList('[1,2]')).toEqual([1, 2]);
		expect(parseIdList('3, 4')).toEqual([3, 4]);
		expect(parseIdList('rusak[')).toEqual([]);
		expect(parseIdList(undefined)).toEqual([]);
	});
});

describe('sampleQuestionIds', () => {
	const bank = Array.from({ length: 25 }, (_, i) => i + 1);
	it('deterministik untuk seed sama & ukuran n', () => {
		const a = sampleQuestionIds(bank, 5, quizSampleSeed(1, 2, 3, 0));
		const b = sampleQuestionIds(bank, 5, quizSampleSeed(1, 2, 3, 0));
		expect(a).toEqual(b);
		expect(a).toHaveLength(5);
		expect(new Set(a).size).toBe(5);
	});
	it('seed berbeda (periode/percobaan) menghasilkan pilihan berbeda', () => {
		const a = sampleQuestionIds(bank, 5, quizSampleSeed(1, 2, 3, 0));
		const b = sampleQuestionIds(bank, 5, quizSampleSeed(1, 2, 4, 0));
		expect(a).not.toEqual(b);
	});
	it('n kosong / terlalu besar = semua soal', () => {
		expect(sampleQuestionIds(bank, null, 'x')).toHaveLength(25);
		expect(sampleQuestionIds(bank, 99, 'x')).toHaveLength(25);
		expect(sampleQuestionIds(bank, 0, 'x')).toHaveLength(25);
	});
});

describe('resolveQuizPeriodState', () => {
	it('lulus periode ini = done; periode lain tidak dihitung', () => {
		expect(resolveQuizPeriodState([{ lulus: true, periode_ke: 1 }], 2, 3, 'pass_only')).toEqual({ state: 'pending', used: 0 });
		expect(resolveQuizPeriodState([{ lulus: true, periode_ke: 2 }], 2, 3, 'pass_only')).toEqual({ state: 'done', used: 1 });
	});
	it('attempt lama tanpa periode_ke dihitung periode 1', () => {
		expect(resolveQuizPeriodState([{ lulus: false }], 1, 3, 'pass_only').used).toBe(1);
	});
	it('percobaan habis: remedial bila attempt_or_pass, tetap pending bila pass_only', () => {
		const gagal = [{ lulus: false }, { lulus: false }, { lulus: false }];
		expect(resolveQuizPeriodState(gagal, 1, 3, 'attempt_or_pass').state).toBe('remedial');
		expect(resolveQuizPeriodState(gagal, 1, 3, 'pass_only').state).toBe('pending');
		expect(resolveQuizPeriodState(gagal.slice(0, 2), 1, 3, 'attempt_or_pass').state).toBe('pending');
	});
});

describe('dispensasi admin', () => {
	it('dispensed membuka kunci, tetapi lulus tetap menang dan periode tak terkait tidak dihitung di pemanggil', () => {
		const gagal = [{ lulus: false }, { lulus: false }];
		expect(resolveQuizPeriodState(gagal, 1, 3, 'pass_only', true)).toEqual({ state: 'dispensed', used: 2 });
		expect(resolveQuizPeriodState([{ lulus: true }], 1, 3, 'pass_only', true).state).toBe('done');
		expect(resolveQuizPeriodState(gagal, 1, 3, 'pass_only', false).state).toBe('pending');
	});
	it('item dispensed tidak dihitung pending pada keputusan gate', () => {
		const items = [{ quizId: 1, state: 'dispensed' as const }];
		expect(decideQuizGate({ mode: 'hard', items, snoozeMinutes: 60, snoozedUntilMs: null, nowMs: NOW })).toMatchObject({ blocking: false, pendingCount: 0 });
	});
});

describe('decideQuizGate', () => {
	const pending = [{ quizId: 1, state: 'pending' as const }];
	const base = { items: pending, snoozeMinutes: 60, snoozedUntilMs: null as number | null, nowMs: NOW };
	it('shadow tidak menampilkan apa pun', () => {
		expect(decideQuizGate({ ...base, mode: 'shadow' })).toMatchObject({ blocking: false, showBanner: false });
	});
	it('warn = banner saja', () => {
		expect(decideQuizGate({ ...base, mode: 'warn' })).toMatchObject({ blocking: false, showBanner: true, canSnooze: false });
	});
	it('soft = kunci + bisa tunda; hard = kunci tanpa tunda', () => {
		expect(decideQuizGate({ ...base, mode: 'soft' })).toMatchObject({ blocking: true, canSnooze: true });
		expect(decideQuizGate({ ...base, mode: 'hard' })).toMatchObject({ blocking: true, canSnooze: false });
		expect(decideQuizGate({ ...base, mode: 'soft', snoozeMinutes: 0 })).toMatchObject({ blocking: true, canSnooze: false });
	});
	it('snooze aktif menurunkan kunci jadi banner; snooze kedaluwarsa mengunci lagi', () => {
		expect(decideQuizGate({ ...base, mode: 'soft', snoozedUntilMs: NOW + 1000 })).toMatchObject({ blocking: false, showBanner: true });
		expect(decideQuizGate({ ...base, mode: 'soft', snoozedUntilMs: NOW - 1 })).toMatchObject({ blocking: true });
	});
	it('semua selesai/remedial = tidak ada gate', () => {
		const items = [{ quizId: 1, state: 'done' as const }, { quizId: 2, state: 'remedial' as const }];
		expect(decideQuizGate({ ...base, items, mode: 'hard' })).toMatchObject({ blocking: false, showBanner: false, pendingCount: 0 });
	});
});

describe('escape path', () => {
	it('default dipakai bila setelan kosong/invalid', () => {
		expect(parseEscapePaths('')).toEqual(DEFAULT_ESCAPE_PATHS);
		expect(parseEscapePaths('abc, def')).toEqual(DEFAULT_ESCAPE_PATHS);
	});
	it('absen & turunannya lolos, menu kerja tidak', () => {
		const p = parseEscapePaths('/ess/absen, /ess/izin-sakit');
		expect(isEscapePath('/ess/absen', p)).toBe(true);
		expect(isEscapePath('/ess/izin-sakit/baru', p)).toBe(true);
		expect(isEscapePath('/ess/absensi-palsu', p)).toBe(false);
		expect(isEscapePath('/laporan-harian', p)).toBe(false);
	});
});
