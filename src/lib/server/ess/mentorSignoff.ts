// src/lib/server/ess/mentorSignoff.ts
// Penegakan gate G_TRN_MENTOR_SIGNOFF (rencana mentor_kpi_training): bawahan yang gagal kuis sampai batas percobaan (max_quiz_attempts) dibina atasan/mentor;
// persetujuan "Sudah Dibina" dari atasan membuka SATU percobaan tambahan. Terdaftar di gate_definitions (mode/enforce_from diatur Superadmin di /settings/gates).
//
// Prinsip (Aturan #3 anti-lockdown): batas percobaan lama TIDAK pernah dilonggarkan oleh mode gate; sign-off atasan SELALU sah membuka percobaan tambahan
// (pelonggaran terkendali, berjejak). Mode hanya menentukan reaksi saat batas tercapai tanpa sign-off tersisa:
//   shadow → hanya dicatat · warn/soft → dicatat + atasan/mentor diingatkan (notifikasi) · hard → dicatat sebagai blok (percobaan ulang hanya lewat sign-off atau reset HRD).
// Penyimpanan tanpa skema baru: gate_audit_log (pola sama dispensasi/snooze kuis): reason 'SIGNOFF…' (persetujuan) dan 'BATAS_TERCAPAI…' (penanda + dedup pengingat).

import { directusServerJson } from '$lib/server/directus';
import { resolveGateMode } from '$lib/server/gateDefinitionsMode';
import { loadMentorConfig, resolveTeamMembers, catatPembinaan, PembinaanError } from '$lib/server/ess/teamTraining';
import { isPeriodicQuiz, quizPeriode, attemptPeriode, type PeriodicQuizRow } from '$lib/utils/quizPeriodic';

export const SIGNOFF_GATE_KEY = 'G_TRN_MENTOR_SIGNOFF';
export const SIGNOFF_DOC_TYPE = 'quiz_attempt';
export type SignoffMode = 'shadow' | 'warn' | 'soft' | 'hard';

const enc = encodeURIComponent;

// ── Murni ────────────────────────────────────────────────────────────────────
export interface SignoffRow {
	record_id: string | null;
	reason?: string | null;
	payload_snapshot: { quiz_id?: number; periode_ke?: number; enrollment_id?: number } | null;
}

/** Jumlah sign-off untuk (enrollment, kuis, periode). periodeKe 0 = kuis non-periodik. */
export function countSignoffs(rows: SignoffRow[], enrollmentId: number, quizId: number, periodeKe: number): number {
	return (rows || []).filter((r) =>
		String(r.record_id) === String(enrollmentId) &&
		String(r.reason || '').startsWith('SIGNOFF') &&
		Number(r.payload_snapshot?.quiz_id) === Number(quizId) &&
		Number(r.payload_snapshot?.periode_ke ?? 0) === Number(periodeKe)
	).length;
}

export interface RetryGateResult {
	effectiveMax: number;
	atLimit: boolean;
	/** true bila percobaan boleh dilanjutkan (di bawah batas efektif). */
	allow: boolean;
	decision: 'pass' | 'shadow' | 'warn' | 'block';
	remindMentor: boolean;
}

/** Batas efektif = max_quiz_attempts + jumlah sign-off. Di batas: tak pernah melonggarkan; mode hanya menentukan keputusan audit & pengingat. */
export function evaluateRetryGate(input: { mode: SignoffMode; attempts: number; maxAttempts: number; signoffs: number }): RetryGateResult {
	const effectiveMax = Math.max(0, input.maxAttempts) + Math.max(0, input.signoffs);
	if (input.attempts < effectiveMax) return { effectiveMax, atLimit: false, allow: true, decision: 'pass', remindMentor: false };
	const decision = input.mode === 'shadow' ? 'shadow' : input.mode === 'hard' ? 'block' : 'warn';
	return { effectiveMax, atLimit: true, allow: false, decision, remindMentor: input.mode !== 'shadow' };
}

// ── I/O ──────────────────────────────────────────────────────────────────────
export async function getSignoffMode(): Promise<SignoffMode> {
	const m = String(await resolveGateMode(SIGNOFF_GATE_KEY, SIGNOFF_DOC_TYPE)).toLowerCase();
	return m === 'warn' || m === 'soft' || m === 'hard' ? m : 'shadow';
}

async function readLog(filter: Record<string, string>): Promise<SignoffRow[]> {
	try {
		const q = new URLSearchParams({ 'filter[gate][_eq]': SIGNOFF_GATE_KEY, ...filter, fields: 'record_id,reason,payload_snapshot', sort: '-id', limit: '-1' });
		return (await directusServerJson<{ data: SignoffRow[] }>(`/items/gate_audit_log?${q.toString()}`))?.data || [];
	} catch (e) {
		console.error('[mentorSignoff] gagal baca gate_audit_log (dianggap kosong):', (e as Error)?.message);
		return [];
	}
}

export async function loadSignoffRows(enrollmentIds: number[]): Promise<SignoffRow[]> {
	const ids = [...new Set(enrollmentIds.filter(Number.isFinite))];
	if (!ids.length) return [];
	return readLog({ 'filter[record_id][_in]': ids.join(','), 'filter[reason][_starts_with]': 'SIGNOFF' });
}

export async function loadSignoffCount(enrollmentId: number, quizId: number, periodeKe: number): Promise<number> {
	return countSignoffs(await loadSignoffRows([enrollmentId]), enrollmentId, quizId, periodeKe);
}

async function writeAudit(row: { decision: string; reason: string; recordId: number; snapshot: Record<string, unknown>; userEmail?: string | null }) {
	try {
		await directusServerJson('/items/gate_audit_log', {
			method: 'POST',
			body: JSON.stringify({
				gate: SIGNOFF_GATE_KEY, collection: 'items/training_quiz_attempt', method: 'CHECK', record_id: String(row.recordId),
				decision: row.decision, reason: row.reason, payload_snapshot: row.snapshot, user_email: row.userEmail ?? null
			})
		});
	} catch (e) {
		console.error('[mentorSignoff] gagal menulis gate_audit_log:', (e as Error)?.message);
	}
}

/** Mentor/atasan penanggung jawab satu karyawan (urutan sumber dari setelan). null bila tidak ada. */
export async function resolveMentorOf(karyawanId: number): Promise<{ id: number; nama: string | null } | null> {
	const c = await loadMentorConfig();
	try {
		const me = (await directusServerJson<{ data: any }>(`/items/karyawan/${karyawanId}?fields=id,${c.sources.join(',')}`))?.data;
		for (const s of c.sources) {
			const v = me?.[s];
			const id = Number(v && typeof v === 'object' ? v.id : v);
			if (Number.isFinite(id) && id > 0 && id !== karyawanId) {
				const m = (await directusServerJson<{ data: { id: number; nama_karyawan: string } }>(`/items/karyawan/${id}?fields=id,nama_karyawan`).catch(() => null))?.data;
				return { id, nama: m?.nama_karyawan ?? null };
			}
		}
	} catch (e) {
		console.error('[mentorSignoff] gagal menentukan mentor:', (e as Error)?.message);
	}
	return null;
}

/**
 * Dipanggil jalur kuis saat batas efektif tercapai. Mencatat kejadian (dedup per enrollment+kuis+periode+jumlah percobaan) dan, bila mode
 * warn/soft/hard, mengingatkan mentor lewat notifikasi dalam aplikasi. Tidak pernah melempar (jejak/pengingat tak boleh menggagalkan respons).
 */
export async function onRetryLimitReached(p: {
	mode: SignoffMode; result: RetryGateResult; enrollmentId: number; quizId: number; quizJudul?: string | null; periodeKe: number;
	karyawan: { id: number; nama_karyawan?: string | null; email_company?: string | null }; attempts: number;
}): Promise<{ mentor: { id: number; nama: string | null } | null }> {
	const marker = `BATAS_TERCAPAI|q${p.quizId}|p${p.periodeKe}|a${p.attempts}`;
	try {
		const mentor = await resolveMentorOf(p.karyawan.id);
		const exists = (await readLog({ 'filter[record_id][_eq]': String(p.enrollmentId), 'filter[reason][_eq]': marker })).length > 0;
		if (!exists) {
			await writeAudit({
				decision: p.result.decision, reason: marker, recordId: p.enrollmentId, userEmail: p.karyawan.email_company ?? null,
				snapshot: { karyawan_id: p.karyawan.id, quiz_id: p.quizId, periode_ke: p.periodeKe, attempts: p.attempts, effective_max: p.result.effectiveMax, mentor_id: mentor?.id ?? null, mode: p.mode }
			});
			if (p.result.remindMentor && mentor) {
				await directusServerJson('/items/app_notifications', {
					method: 'POST',
					body: JSON.stringify({
						type: 'MENTOR_SIGNOFF_REQUEST', priority: 'medium', department: 'hrd', user_id: String(mentor.id), action_required: true, action_url: '/ess/pelatihan/tim',
						title: `[Pembinaan] ${p.karyawan.nama_karyawan || 'Bawahan'} gagal kuis sampai batas percobaan`,
						message: `${p.karyawan.nama_karyawan || 'Bawahan Anda'} sudah mencapai batas percobaan kuis${p.quizJudul ? ` "${p.quizJudul}"` : ''}. Bina dulu, lalu setujui percobaan ulang di Pantauan Tim.`,
						created_at: new Date().toISOString()
					})
				});
			}
		}
		return { mentor };
	} catch (e) {
		console.error('[mentorSignoff] onRetryLimitReached gagal (diabaikan):', (e as Error)?.message);
		return { mentor: null };
	}
}

export class SignoffError extends Error {
	constructor(message: string, public status: number) { super(message); }
}

/**
 * Atasan menyetujui SATU percobaan ulang untuk bawahannya. Otorisasi: enrollment HARUS milik anggota tim atasan (resolveTeamMembers); syarat: kuis memang di
 * batas efektif & belum lulus. Catatan wajib (≥5 karakter) — ikut tersimpan sebagai Action Plan pembinaan (dilihat gate G_KPI_MENTOR_ACCOUNTABILITY).
 */
export async function approveRetry(
	manager: { id: number; nama_karyawan?: string | null; divisi?: string | null; email_company?: string | null },
	input: { enrollmentId: number; quizId: number; catatan: string }
): Promise<{ sisaPercobaan: number; planId: number | null }> {
	const catatan = String(input.catatan || '').trim().slice(0, 1500);
	if (catatan.length < 5) throw new SignoffError('Catatan pembinaan minimal 5 karakter.', 400);

	const enr = (await directusServerJson<{ data: { id: number; karyawan_id: number | { id: number }; status: string } | null }>(
		`/items/training_enrollment/${input.enrollmentId}?fields=id,karyawan_id,status`
	).catch(() => null))?.data;
	if (!enr) throw new SignoffError('Pendaftaran training tidak ditemukan.', 404);
	const memberId = Number(typeof enr.karyawan_id === 'object' ? enr.karyawan_id?.id : enr.karyawan_id);

	const c = await loadMentorConfig();
	if (c.mode === 'off') throw new SignoffError('Fitur pembinaan tim sedang dinonaktifkan.', 403);
	const team = await resolveTeamMembers(manager.id, c);
	const member = team.find((m) => Number(m.id) === memberId);
	if (!member) throw new SignoffError('Karyawan ini bukan bawahan Anda.', 403);

	const quiz = (await directusServerJson<{ data: (PeriodicQuizRow & { id: number; judul?: string }) | null }>(
		`/items/training_quiz/${input.quizId}?fields=id,judul,periode_ke,recurrence_type,is_mandatory_gate`
	).catch(() => null))?.data;
	if (!quiz) throw new SignoffError('Kuis tidak ditemukan.', 404);
	const periodik = isPeriodicQuiz(quiz);
	const periodeKe = periodik ? quizPeriode(quiz) : 0;

	const attempts = (await directusServerJson<{ data: { lulus: boolean | null; periode_ke?: number | null }[] }>(
		`/items/training_quiz_attempt?filter[enrollment_id][_eq]=${input.enrollmentId}&filter[quiz_id][_eq]=${input.quizId}&fields=lulus,periode_ke&limit=-1`
	))?.data || [];
	const dalamPeriode = periodik ? attempts.filter((a) => attemptPeriode(a) === periodeKe) : attempts;
	if (dalamPeriode.some((a) => a.lulus === true)) throw new SignoffError('Bawahan ini sudah lulus kuis tersebut.', 409);

	const max = (await directusServerJson<{ data: { max_quiz_attempts?: number } }>('/items/training_settings').catch(() => null))?.data?.max_quiz_attempts ?? 3;
	const signoffs = await loadSignoffCount(input.enrollmentId, input.quizId, periodeKe);
	const r = evaluateRetryGate({ mode: 'hard', attempts: dalamPeriode.length, maxAttempts: max, signoffs });
	if (!r.atLimit) throw new SignoffError('Bawahan ini belum mencapai batas percobaan — tidak perlu persetujuan.', 409);

	await writeAudit({
		decision: 'pass', reason: `SIGNOFF|q${input.quizId}|p${periodeKe}|n${signoffs + 1}`, recordId: input.enrollmentId, userEmail: manager.email_company ?? null,
		snapshot: { karyawan_id: memberId, quiz_id: input.quizId, periode_ke: periodeKe, enrollment_id: input.enrollmentId, mentor_id: manager.id, mentor_nama: manager.nama_karyawan ?? null, catatan }
	});

	let planId: number | null = null;
	try {
		planId = (await catatPembinaan(manager, { memberId, catatan: `Setujui percobaan ulang kuis${quiz.judul ? ` "${quiz.judul}"` : ''}: ${catatan}` })).planId;
	} catch (e) {
		if (!(e instanceof PembinaanError)) console.error('[mentorSignoff] catat pembinaan gagal (sign-off tetap sah):', (e as Error)?.message);
	}
	return { sisaPercobaan: 1, planId };
}

// ── Daftar persetujuan yang menunggu atasan (untuk Pantauan Tim) ──────────────
export interface PendingSignoff { enrollmentId: number; karyawanId: number; quizId: number; quizJudul: string; periodeKe: number; percobaan: number }

/** Murni: dari enrollment + percobaan + kuis + sign-off → yang sudah di batas efektif dan belum lulus. */
export function pendingFrom(
	enrollments: { id: number; karyawan_id: number | { id: number } }[],
	attempts: { enrollment_id: number | { id: number }; quiz_id: number | { id: number }; lulus: boolean | null; periode_ke?: number | null }[],
	quizzes: (PeriodicQuizRow & { id: number; judul?: string })[],
	signoffRows: SignoffRow[],
	maxAttempts: number
): PendingSignoff[] {
	const idOf = (v: unknown) => Number(v && typeof v === 'object' ? (v as { id: number }).id : v);
	const owner = new Map(enrollments.map((e) => [Number(e.id), idOf(e.karyawan_id)]));
	const quizById = new Map(quizzes.map((q) => [Number(q.id), q]));
	const groups = new Map<string, { enrollmentId: number; quizId: number; periodeKe: number; n: number; lulus: boolean }>();
	for (const a of attempts) {
		const enrollmentId = idOf(a.enrollment_id);
		const quizId = idOf(a.quiz_id);
		const q = quizById.get(quizId);
		if (!q || !owner.has(enrollmentId)) continue;
		const periodik = isPeriodicQuiz(q);
		const periodeKe = periodik ? quizPeriode(q) : 0;
		if (periodik && attemptPeriode(a) !== periodeKe) continue; // kuis periodik: hanya periode berjalan
		const key = `${enrollmentId}|${quizId}`;
		const g = groups.get(key) || { enrollmentId, quizId, periodeKe, n: 0, lulus: false };
		g.n += 1;
		if (a.lulus === true) g.lulus = true;
		groups.set(key, g);
	}
	return [...groups.values()]
		.filter((g) => !g.lulus && g.n >= maxAttempts + countSignoffs(signoffRows, g.enrollmentId, g.quizId, g.periodeKe))
		.map((g) => ({ enrollmentId: g.enrollmentId, karyawanId: owner.get(g.enrollmentId)!, quizId: g.quizId, quizJudul: quizById.get(g.quizId)?.judul || `Kuis #${g.quizId}`, periodeKe: g.periodeKe, percobaan: g.n }));
}

/** I/O: 4-5 query (enrollment, percobaan, kuis, setelan, sign-off) hanya untuk anggota tim; gagal = daftar kosong + log (tak menggagalkan Pantauan Tim). */
export async function listPendingSignoffs(memberIds: number[]): Promise<PendingSignoff[]> {
	const ids = [...new Set(memberIds.filter(Number.isFinite))];
	if (!ids.length) return [];
	try {
		const enrollments = (await directusServerJson<{ data: { id: number; karyawan_id: number }[] }>(
			`/items/training_enrollment?filter[karyawan_id][_in]=${ids.join(',')}&filter[status][_neq]=Cancelled&fields=id,karyawan_id&limit=-1`
		))?.data || [];
		if (!enrollments.length) return [];
		const eIds = enrollments.map((e) => e.id);
		const attempts = (await directusServerJson<{ data: { enrollment_id: number; quiz_id: number; lulus: boolean | null; periode_ke: number | null }[] }>(
			`/items/training_quiz_attempt?filter[enrollment_id][_in]=${eIds.join(',')}&fields=enrollment_id,quiz_id,lulus,periode_ke&limit=-1`
		))?.data || [];
		if (!attempts.length) return [];
		const quizIds = [...new Set(attempts.map((a) => Number(a.quiz_id)))];
		const quizzes = (await directusServerJson<{ data: (PeriodicQuizRow & { id: number; judul?: string })[] }>(
			`/items/training_quiz?filter[id][_in]=${quizIds.join(',')}&fields=id,judul,periode_ke,recurrence_type,is_mandatory_gate&limit=-1`
		))?.data || [];
		const max = (await directusServerJson<{ data: { max_quiz_attempts?: number } }>('/items/training_settings').catch(() => null))?.data?.max_quiz_attempts ?? 3;
		return pendingFrom(enrollments, attempts, quizzes, await loadSignoffRows(eIds), max);
	} catch (e) {
		console.error('[mentorSignoff] listPendingSignoffs gagal (daftar kosong):', (e as Error)?.message);
		return [];
	}
}
