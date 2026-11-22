import { describe, it, expect, vi, beforeEach } from 'vitest';

const dx = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => dx(...a) }));
const resolveMode = vi.fn();
vi.mock('$lib/server/gateDefinitionsMode', () => ({ resolveGateMode: (...a: any[]) => resolveMode(...a) }));
const ensureEnroll = vi.fn();
vi.mock('$lib/server/ess/training', async () => {
	const real = await vi.importActual<any>('$lib/utils/quizPeriodic');
	return {
		QUIZ_FIELDS: 'id',
		attemptsInPeriod: (a: any[], p: number) => a.filter((x) => real.attemptPeriode(x) === p),
		ensureEnrollmentForTargetedQuiz: (...a: any[]) => ensureEnroll(...a),
		fetchMaxQuizAttempts: async () => 3
	};
});

import { getQuizGateStatus, snoozeQuizGate, summarizeSnoozes, clearQuizGateCache } from './quizGate';

const NOW = new Date('2026-11-16T03:00:00Z').getTime(); // Senin 10:00 WIB
const karyawan = { id: 5, divisi_id: 2 };
const quiz = {
	id: 7, program_id: 3, module_id: null, judul: 'Mini K3', passing_score: 70, tanggal_mulai: '2026-11-16T00:00:00Z', tanggal_selesai: '2026-11-16T10:00:00Z',
	durasi_menit: 5, is_mandatory_gate: true, bypass_module_lock: true, recurrence_type: 'weekly', prep_notify_days: 7, jumlah_soal_tampil: null,
	target_divisi_ids: [2], target_karyawan_ids: null, periode_ke: 4
};

function route(opts: { quizzes?: any[]; attempts?: any[]; enrollments?: any[]; snoozes?: any[]; settings?: any[]; dispensasi?: any[] } = {}) {
	dx.mockImplementation(async (path: string, init?: any) => {
		if (init?.method === 'POST') return { data: {} };
		if (path.startsWith('/items/training_quiz?')) return { data: opts.quizzes ?? [quiz] };
		if (path.startsWith('/items/app_settings')) return { data: opts.settings ?? [] };
		if (path.startsWith('/items/training_enrollment?')) return { data: opts.enrollments ?? [{ id: 11, program_id: 3 }] };
		if (path.startsWith('/items/training_quiz_attempt?')) return { data: opts.attempts ?? [] };
		if (path.startsWith('/items/gate_audit_log?')) return { data: path.includes('DISPENSASI') ? (opts.dispensasi ?? []) : (opts.snoozes ?? []) };
		return { data: [] };
	});
}

beforeEach(() => {
	dx.mockReset();
	resolveMode.mockReset();
	ensureEnroll.mockReset();
	clearQuizGateCache();
});

describe('getQuizGateStatus', () => {
	it('tanpa kuis aktif / segera dibuka: hasil kosong, TANPA query tambahan selain daftar kuis', async () => {
		route({ quizzes: [{ ...quiz, tanggal_mulai: '2026-12-30T00:00:00Z', tanggal_selesai: '2026-12-30T10:00:00Z' }] });
		const s = await getQuizGateStatus(karyawan, 'a@b.c', NOW);
		expect(s).toMatchObject({ blocking: false, showBanner: false, items: [], upcoming: [] });
		expect(dx).toHaveBeenCalledTimes(1);
		expect(resolveMode).not.toHaveBeenCalled();
	});

	it('mode shadow: tidak menampilkan apa pun dan tidak query data peserta', async () => {
		route();
		resolveMode.mockResolvedValue('shadow');
		const s = await getQuizGateStatus(karyawan, 'a@b.c', NOW);
		expect(s).toMatchObject({ mode: 'shadow', blocking: false, showBanner: false, items: [] });
		expect(dx.mock.calls.some((c) => String(c[0]).startsWith('/items/training_enrollment'))).toBe(false);
	});

	it('hard + belum mengerjakan = blocking; lulus periode ini = terbuka', async () => {
		resolveMode.mockResolvedValue('hard');
		route();
		const blok = await getQuizGateStatus(karyawan, 'a@b.c', NOW);
		expect(blok).toMatchObject({ mode: 'hard', blocking: true, canSnooze: false, pendingCount: 1 });
		expect(blok.items[0]).toMatchObject({ quizId: 7, state: 'pending', periodeKe: 4 });

		clearQuizGateCache();
		route({ attempts: [{ enrollment_id: 11, quiz_id: 7, lulus: true, periode_ke: 4 }] });
		const buka = await getQuizGateStatus(karyawan, 'a@b.c', NOW);
		expect(buka).toMatchObject({ blocking: false, pendingCount: 0 });
		expect(buka.items[0].state).toBe('done');
	});

	it('lulus di periode LAMA tidak membebaskan periode baru', async () => {
		resolveMode.mockResolvedValue('hard');
		route({ attempts: [{ enrollment_id: 11, quiz_id: 7, lulus: true, periode_ke: 3 }] });
		const s = await getQuizGateStatus(karyawan, 'a@b.c', NOW);
		expect(s.blocking).toBe(true);
	});

	it('percobaan habis: remedial membuka kunci (attempt_or_pass default), pass_only tetap mengunci', async () => {
		resolveMode.mockResolvedValue('hard');
		const gagal = [1, 2, 3].map(() => ({ enrollment_id: 11, quiz_id: 7, lulus: false, periode_ke: 4 }));
		route({ attempts: gagal });
		const s = await getQuizGateStatus(karyawan, 'a@b.c', NOW);
		expect(s.items[0].state).toBe('remedial');
		expect(s.blocking).toBe(false);

		clearQuizGateCache();
		route({ attempts: gagal, settings: [{ setting_key: 'quiz_gate_unlock_policy', setting_value: 'pass_only' }] });
		const p = await getQuizGateStatus(karyawan, 'a@b.c', NOW);
		expect(p.blocking).toBe(true);
	});

	it('dispensasi admin untuk periode ini membuka kunci; untuk karyawan/periode lain tidak', async () => {
		resolveMode.mockResolvedValue('hard');
		route({ dispensasi: [{ record_id: '7', payload_snapshot: { karyawan_id: 5, periode_ke: 4 } }] });
		const buka = await getQuizGateStatus(karyawan, 'a@b.c', NOW);
		expect(buka.items[0].state).toBe('dispensed');
		expect(buka.blocking).toBe(false);

		clearQuizGateCache();
		route({ dispensasi: [{ record_id: '7', payload_snapshot: { karyawan_id: 6, periode_ke: 4 } }, { record_id: '7', payload_snapshot: { karyawan_id: 5, periode_ke: 3 } }] });
		expect((await getQuizGateStatus(karyawan, 'a@b.c', NOW)).blocking).toBe(true);
	});

	it('bukan target (divisi lain) → tidak terkena gate', async () => {
		resolveMode.mockResolvedValue('hard');
		route();
		const s = await getQuizGateStatus({ id: 5, divisi_id: 99 }, 'a@b.c', NOW);
		expect(s).toMatchObject({ blocking: false, items: [] });
	});

	it('target spesifik belum terdaftar → didaftarkan JIT', async () => {
		resolveMode.mockResolvedValue('warn');
		ensureEnroll.mockResolvedValue({ id: 22 });
		route({ enrollments: [] });
		const s = await getQuizGateStatus(karyawan, 'a@b.c', NOW);
		expect(ensureEnroll).toHaveBeenCalledWith(5, 3);
		expect(s).toMatchObject({ mode: 'warn', blocking: false, showBanner: true, pendingCount: 1 });
	});

	it('kuis segera dibuka (H-3) tampil sebagai upcoming', async () => {
		resolveMode.mockResolvedValue('warn');
		route({ quizzes: [{ ...quiz, tanggal_mulai: '2026-11-19T00:00:00Z', tanggal_selesai: '2026-11-19T10:00:00Z' }] });
		const s = await getQuizGateStatus(karyawan, 'a@b.c', NOW);
		expect(s.upcoming).toHaveLength(1);
		expect(s.upcoming[0]).toMatchObject({ quizId: 7, hariLagi: 3 });
	});

	it('gagal membaca kuis = fail-open (tidak mengunci)', async () => {
		dx.mockRejectedValue(new Error('directus down'));
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const s = await getQuizGateStatus(karyawan, 'a@b.c', NOW);
		spy.mockRestore();
		expect(s).toMatchObject({ blocking: false, showBanner: false });
	});
});

describe('snooze', () => {
	const snoozeRow = (until: string, periode = 4) => ({ record_id: '7', payload_snapshot: { periode_ke: periode, snoozed_until: until } });

	it('summarizeSnoozes: aktif / kedaluwarsa / periode lain', () => {
		const pending = [{ quizId: 7, periodeKe: 4 }];
		expect(summarizeSnoozes([snoozeRow('2026-11-16T04:00:00Z')], pending, NOW)).toEqual({ snoozeUsed: true, snoozedUntilMs: new Date('2026-11-16T04:00:00Z').getTime() });
		expect(summarizeSnoozes([snoozeRow('2026-11-16T02:00:00Z')], pending, NOW)).toEqual({ snoozeUsed: true, snoozedUntilMs: null });
		expect(summarizeSnoozes([snoozeRow('2026-11-16T04:00:00Z', 3)], pending, NOW)).toEqual({ snoozeUsed: false, snoozedUntilMs: null });
	});

	it('soft: tunda menurunkan kunci jadi banner; jatah habis = tetap mengunci tanpa tombol tunda', async () => {
		resolveMode.mockResolvedValue('soft');
		route({ snoozes: [snoozeRow('2026-11-16T04:00:00Z')] });
		const aktif = await getQuizGateStatus(karyawan, 'a@b.c', NOW);
		expect(aktif).toMatchObject({ blocking: false, showBanner: true, canSnooze: false });

		clearQuizGateCache();
		route({ snoozes: [snoozeRow('2026-11-16T02:00:00Z')] });
		const habis = await getQuizGateStatus(karyawan, 'a@b.c', NOW);
		expect(habis).toMatchObject({ blocking: true, canSnooze: false });
	});

	it('snoozeQuizGate: alasan pendek ditolak; soft menulis audit sinkron; mode hard ditolak', async () => {
		resolveMode.mockResolvedValue('soft');
		route();
		await expect(snoozeQuizGate(karyawan, 'a@b.c', 'sibuk', NOW)).rejects.toMatchObject({ status: 400 });
		const r = await snoozeQuizGate(karyawan, 'a@b.c', 'Sedang menangani kebocoran di site', NOW);
		expect(new Date(r.snoozedUntil).getTime()).toBe(NOW + 60 * 60_000);
		const post = dx.mock.calls.find((c) => c[0] === '/items/gate_audit_log' && c[1]?.method === 'POST');
		expect(JSON.parse(post![1].body)).toMatchObject({ gate: 'G_TRN_QUIZ_PERIODIC_WAJIB', record_id: '7', user_email: 'a@b.c' });
		expect(JSON.parse(post![1].body).reason).toMatch(/^SNOOZE:/);

		clearQuizGateCache();
		resolveMode.mockResolvedValue('hard');
		route();
		await expect(snoozeQuizGate(karyawan, 'a@b.c', 'Sedang menangani kebocoran di site', NOW)).rejects.toMatchObject({ status: 409 });
	});
});
