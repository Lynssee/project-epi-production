import { describe, it, expect, vi, beforeEach } from 'vitest';

const dx = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => dx(...a) }));
vi.mock('$lib/server/gateDefinitionsMode', () => ({ resolveGateMode: vi.fn(async () => 'warn') }));

import { countSignoffs, evaluateRetryGate, pendingFrom, approveRetry, SignoffError, onRetryLimitReached } from './mentorSignoff';
import { _resetTeamTrainingCacheForTest } from './teamTraining';

const row = (enr: number, quiz: number, periode: number, reason = 'SIGNOFF|x') => ({ record_id: String(enr), reason, payload_snapshot: { quiz_id: quiz, periode_ke: periode, enrollment_id: enr } });

describe('countSignoffs & evaluateRetryGate (murni)', () => {
	it('hanya menghitung sign-off untuk enrollment+kuis+periode yang sama', () => {
		const rows = [row(5, 7, 0), row(5, 7, 0), row(5, 8, 0), row(6, 7, 0), row(5, 7, 2), { ...row(5, 7, 0), reason: 'BATAS_TERCAPAI|q7' }];
		expect(countSignoffs(rows, 5, 7, 0)).toBe(2);
		expect(countSignoffs(rows, 5, 7, 2)).toBe(1);
		expect(countSignoffs([], 5, 7, 0)).toBe(0);
	});
	it('di bawah batas efektif → boleh; batas efektif = maks + sign-off', () => {
		expect(evaluateRetryGate({ mode: 'hard', attempts: 2, maxAttempts: 3, signoffs: 0 })).toMatchObject({ allow: true, atLimit: false, decision: 'pass' });
		expect(evaluateRetryGate({ mode: 'hard', attempts: 3, maxAttempts: 3, signoffs: 1 })).toMatchObject({ allow: true, effectiveMax: 4 });
	});
	it('di batas: tak pernah melonggarkan; mode hanya mengubah keputusan audit & pengingat', () => {
		expect(evaluateRetryGate({ mode: 'shadow', attempts: 3, maxAttempts: 3, signoffs: 0 })).toMatchObject({ allow: false, decision: 'shadow', remindMentor: false });
		expect(evaluateRetryGate({ mode: 'warn', attempts: 3, maxAttempts: 3, signoffs: 0 })).toMatchObject({ allow: false, decision: 'warn', remindMentor: true });
		expect(evaluateRetryGate({ mode: 'soft', attempts: 4, maxAttempts: 3, signoffs: 0 })).toMatchObject({ allow: false, decision: 'warn' });
		expect(evaluateRetryGate({ mode: 'hard', attempts: 3, maxAttempts: 3, signoffs: 0 })).toMatchObject({ allow: false, decision: 'block', remindMentor: true });
	});
});

describe('pendingFrom', () => {
	const enrollments = [{ id: 5, karyawan_id: 2 }, { id: 6, karyawan_id: 3 }];
	const quizzes: any[] = [
		{ id: 7, judul: 'K3 Dasar', recurrence_type: 'once', is_mandatory_gate: false, periode_ke: 1 },
		{ id: 8, judul: 'Mingguan', recurrence_type: 'weekly', is_mandatory_gate: true, periode_ke: 4 }
	];
	const at = (e: number, q: number, lulus: boolean | null, periode_ke: number | null = null) => ({ enrollment_id: e, quiz_id: q, lulus, periode_ke });
	it('di batas & belum lulus → pending; sudah lulus / belum di batas → tidak', () => {
		const attempts = [at(5, 7, false), at(5, 7, false), at(5, 7, false), at(6, 7, false), at(6, 7, true)];
		expect(pendingFrom(enrollments, attempts, quizzes, [], 3)).toEqual([{ enrollmentId: 5, karyawanId: 2, quizId: 7, quizJudul: 'K3 Dasar', periodeKe: 0, percobaan: 3 }]);
	});
	it('sign-off membuat percobaan tambahan: 3 percobaan + 1 sign-off → belum pending; 4 percobaan → pending lagi', () => {
		const three = [at(5, 7, false), at(5, 7, false), at(5, 7, false)];
		expect(pendingFrom(enrollments, three, quizzes, [row(5, 7, 0)], 3)).toEqual([]);
		expect(pendingFrom(enrollments, [...three, at(5, 7, false)], quizzes, [row(5, 7, 0)], 3)).toHaveLength(1);
	});
	it('kuis periodik: hanya percobaan periode berjalan yang dihitung', () => {
		const attempts = [at(5, 8, false, 3), at(5, 8, false, 3), at(5, 8, false, 3), at(5, 8, false, 4)];
		expect(pendingFrom(enrollments, attempts, quizzes, [], 3)).toEqual([]);
		const full = [...attempts, at(5, 8, false, 4), at(5, 8, false, 4)];
		expect(pendingFrom(enrollments, full, quizzes, [], 3)).toMatchObject([{ quizId: 8, periodeKe: 4, percobaan: 3 }]);
	});
});

const members = [{ id: 2, nama_karyawan: 'Ani', status: 'on', atasan_id: 1, atasan_fungsional_id: null }];
function route(opts: { enrFor?: number; attempts?: any[]; signoffs?: any[]; members?: any[]; quiz?: any } = {}) {
	dx.mockImplementation(async (path: string, init?: any) => {
		if (path.startsWith('/items/app_settings')) return { data: [{ setting_key: 'mentor_kpi_mode', setting_value: 'shadow' }] };
		if (path.startsWith('/items/training_enrollment/')) return { data: { id: 5, karyawan_id: opts.enrFor ?? 2, status: 'Remedial' } };
		if (path.startsWith('/items/karyawan?')) return { data: opts.members ?? members };
		if (path.startsWith('/items/training_quiz/')) return { data: opts.quiz ?? { id: 7, judul: 'K3 Dasar', recurrence_type: 'once', is_mandatory_gate: false, periode_ke: 1 } };
		if (path.startsWith('/items/training_quiz_attempt')) return { data: opts.attempts ?? [{ lulus: false }, { lulus: false }, { lulus: false }] };
		if (path.startsWith('/items/training_settings')) return { data: { max_quiz_attempts: 3 } };
		if (path.startsWith('/items/gate_audit_log?')) return { data: opts.signoffs ?? [] };
		if (path === '/items/gate_audit_log' && init?.method === 'POST') return { data: {} };
		if (path.startsWith('/items/kpi_action_plans?')) return { data: [] };
		if (path === '/items/kpi_action_plans' && init?.method === 'POST') return { data: { id: 99 } };
		throw new Error('unexpected ' + path);
	});
}
const mgr = { id: 1, nama_karyawan: 'Pak Atasan', divisi: 'PRODUKSI', email_company: 'a@x.id' };

describe('approveRetry', () => {
	beforeEach(() => { dx.mockReset(); _resetTeamTrainingCacheForTest(); });

	it('menyetujui: menulis SIGNOFF ke gate_audit_log + Action Plan pembinaan', async () => {
		route();
		const r = await approveRetry(mgr, { enrollmentId: 5, quizId: 7, catatan: 'Sudah dibina ulang materi K3' });
		expect(r).toEqual({ sisaPercobaan: 1, planId: 99 });
		const post = dx.mock.calls.find((c) => c[0] === '/items/gate_audit_log' && c[1]?.method === 'POST');
		const body = JSON.parse(post![1].body);
		expect(body).toMatchObject({ gate: 'G_TRN_MENTOR_SIGNOFF', record_id: '5' });
		expect(body.reason).toMatch(/^SIGNOFF\|q7\|p0/);
		expect(body.payload_snapshot).toMatchObject({ karyawan_id: 2, quiz_id: 7, mentor_id: 1 });
	});
	it('menolak bawahan orang lain (otorisasi server)', async () => {
		route({ enrFor: 4 });
		await expect(approveRetry(mgr, { enrollmentId: 5, quizId: 7, catatan: 'Sudah dibina ulang' })).rejects.toMatchObject({ status: 403 });
	});
	it('menolak bila belum di batas / sudah lulus / catatan pendek', async () => {
		route({ attempts: [{ lulus: false }] });
		await expect(approveRetry(mgr, { enrollmentId: 5, quizId: 7, catatan: 'Sudah dibina ulang' })).rejects.toMatchObject({ status: 409 });
		route({ attempts: [{ lulus: false }, { lulus: true }] });
		await expect(approveRetry(mgr, { enrollmentId: 5, quizId: 7, catatan: 'Sudah dibina ulang' })).rejects.toMatchObject({ status: 409 });
		route();
		await expect(approveRetry(mgr, { enrollmentId: 5, quizId: 7, catatan: 'ok' })).rejects.toBeInstanceOf(SignoffError);
	});
	it('persetujuan belum terpakai → tidak boleh menumpuk', async () => {
		route({ signoffs: [row(5, 7, 0)] }); // 3 percobaan + 1 sign-off → batas efektif 4, belum di batas
		await expect(approveRetry(mgr, { enrollmentId: 5, quizId: 7, catatan: 'Sudah dibina ulang' })).rejects.toMatchObject({ status: 409 });
	});
});

describe('onRetryLimitReached', () => {
	beforeEach(() => { dx.mockReset(); _resetTeamTrainingCacheForTest(); });
	const base = { enrollmentId: 5, quizId: 7, quizJudul: 'K3', periodeKe: 0, attempts: 3, karyawan: { id: 2, nama_karyawan: 'Ani' } };
	function route2(log: any[]) {
		dx.mockImplementation(async (path: string, init?: any) => {
			if (path.startsWith('/items/app_settings')) return { data: [] };
			if (path.startsWith('/items/karyawan/2')) return { data: { id: 2, atasan_id: 1 } };
			if (path.startsWith('/items/karyawan/1')) return { data: { id: 1, nama_karyawan: 'Pak Atasan' } };
			if (path.startsWith('/items/gate_audit_log?')) return { data: log };
			if (init?.method === 'POST') return { data: {} };
			throw new Error('unexpected ' + path);
		});
	}
	it('warn: mencatat + notifikasi ke mentor; panggilan kedua (marker ada) tidak menduplikasi', async () => {
		route2([]);
		const res = evaluateRetryGate({ mode: 'warn', attempts: 3, maxAttempts: 3, signoffs: 0 });
		const r = await onRetryLimitReached({ ...base, mode: 'warn', result: res });
		expect(r.mentor).toEqual({ id: 1, nama: 'Pak Atasan' });
		expect(dx.mock.calls.filter((c) => c[1]?.method === 'POST').map((c) => c[0])).toEqual(['/items/gate_audit_log', '/items/app_notifications']);
		dx.mockClear();
		route2([{ record_id: '5', reason: 'BATAS_TERCAPAI|q7|p0|a3', payload_snapshot: {} }]);
		await onRetryLimitReached({ ...base, mode: 'warn', result: res });
		expect(dx.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(0);
	});
	it('shadow: hanya mencatat, tanpa notifikasi', async () => {
		route2([]);
		const res = evaluateRetryGate({ mode: 'shadow', attempts: 3, maxAttempts: 3, signoffs: 0 });
		await onRetryLimitReached({ ...base, mode: 'shadow', result: res });
		expect(dx.mock.calls.filter((c) => c[1]?.method === 'POST').map((c) => c[0])).toEqual(['/items/gate_audit_log']);
	});
});
