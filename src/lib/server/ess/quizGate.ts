// src/lib/server/ess/quizGate.ts
// SERVER-ONLY. App-Blocking Gate G_TRN_QUIZ_PERIODIC_WAJIB (Quiz Asynchronous Terjadwal, 12 Nov 2026).
//
// Hemat resource: daftar kuis wajib-gate di-cache 5 menit; bila tidak ada kuis yang jendelanya aktif / segera dibuka,
// endpoint mengembalikan hasil kosong dengan NOL query tambahan. Mode gate (shadow/warn/soft/hard) dibaca dari
// gate_definitions + gate_enforcement lewat resolveGateMode (diatur Superadmin di /settings/gates — bukan hardcode, Aturan #11);
// kebijakan buka kunci / durasi tunda / escape path dari app_settings training_lms. Gagal baca = fail-open (dilog) —
// gate tidak boleh melumpuhkan lapangan karena gangguan Directus (Aturan #3).

import { directusServerJson } from '$lib/server/directus';
import { resolveGateMode } from '$lib/server/gateDefinitionsMode';
import {
	QUIZ_FIELDS,
	attemptsInPeriod,
	ensureEnrollmentForTargetedQuiz,
	fetchMaxQuizAttempts
} from '$lib/server/ess/training';
import {
	DEFAULT_ESCAPE_PATHS,
	DEFAULT_SNOOZE_MINUTES,
	DEFAULT_UNLOCK_POLICY,
	daysUntilStart,
	decideQuizGate,
	isGateWindowActive,
	parseEscapePaths,
	quizPeriode,
	quizTargetScope,
	resolveQuizPeriodState,
	type PeriodicQuizRow,
	type QuizGateMode,
	type QuizPeriodState,
	type UnlockPolicy
} from '$lib/utils/quizPeriodic';

export const QUIZ_GATE_KEY = 'G_TRN_QUIZ_PERIODIC_WAJIB';
export const QUIZ_GATE_DOCUMENT_TYPE = 'training_quiz';
const CACHE_TTL_MS = 300_000;

export interface QuizGateItem {
	quizId: number;
	programId: number;
	judul: string;
	periodeKe: number;
	state: QuizPeriodState;
	attemptsUsed: number;
	maxAttempts: number;
	tanggalSelesai: string | null;
	durasiMenit: number | null;
	/** Flashcard persiapan 1 menit (3-5 poin) — tampil di layar kunci agar bisa dibaca sebelum mengerjakan. */
	ringkasanPoin: string[];
}

export interface QuizGateUpcoming {
	quizId: number;
	programId: number;
	judul: string;
	tanggalMulai: string;
	hariLagi: number;
}

export interface QuizGateStatus {
	mode: QuizGateMode;
	blocking: boolean;
	showBanner: boolean;
	canSnooze: boolean;
	snoozeMinutes: number;
	snoozedUntil: string | null;
	pendingCount: number;
	unlockPolicy: UnlockPolicy;
	escapePaths: string[];
	items: QuizGateItem[];
	upcoming: QuizGateUpcoming[];
}

/** Poin ringkasan bersih: hanya teks tak kosong, maks 8. */
export function cleanRingkasan(raw: unknown): string[] {
	return (Array.isArray(raw) ? raw : []).map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 8);
}

export const EMPTY_QUIZ_GATE: QuizGateStatus = Object.freeze({
	mode: 'shadow',
	blocking: false,
	showBanner: false,
	canSnooze: false,
	snoozeMinutes: DEFAULT_SNOOZE_MINUTES,
	snoozedUntil: null,
	pendingCount: 0,
	unlockPolicy: DEFAULT_UNLOCK_POLICY,
	escapePaths: [...DEFAULT_ESCAPE_PATHS],
	items: [],
	upcoming: []
}) as QuizGateStatus;

// ── Cache ────────────────────────────────────────────────────────────────────
let quizCache: { at: number; rows: PeriodicQuizRow[] } | null = null;
let settingsCache: { at: number; value: { policy: UnlockPolicy; snoozeMinutes: number; escapePaths: string[] } } | null = null;

export function clearQuizGateCache(): void {
	quizCache = null;
	settingsCache = null;
}

async function loadMandatoryQuizzes(): Promise<PeriodicQuizRow[]> {
	if (quizCache && Date.now() - quizCache.at < CACHE_TTL_MS) return quizCache.rows;
	const query = new URLSearchParams({
		'filter[is_mandatory_gate][_eq]': 'true',
		'filter[tanggal_mulai][_nnull]': 'true',
		fields: QUIZ_FIELDS,
		limit: '-1'
	});
	const res = await directusServerJson<{ data: PeriodicQuizRow[] }>(`/items/training_quiz?${query.toString()}`);
	const rows = res?.data || [];
	quizCache = { at: Date.now(), rows };
	return rows;
}

export async function getQuizGateSettings(): Promise<{ policy: UnlockPolicy; snoozeMinutes: number; escapePaths: string[] }> {
	if (settingsCache && Date.now() - settingsCache.at < CACHE_TTL_MS) return settingsCache.value;
	let value = { policy: DEFAULT_UNLOCK_POLICY, snoozeMinutes: DEFAULT_SNOOZE_MINUTES, escapePaths: [...DEFAULT_ESCAPE_PATHS] };
	try {
		const res = await directusServerJson<{ data: Array<{ setting_key: string; setting_value: unknown }> }>(
			'/items/app_settings?filter[module][_eq]=training_lms&filter[setting_key][_starts_with]=quiz_gate_&fields=setting_key,setting_value&limit=-1'
		);
		const byKey = new Map((res?.data || []).map((r) => [r.setting_key, r.setting_value]));
		const policy = byKey.get('quiz_gate_unlock_policy') === 'pass_only' ? 'pass_only' : 'attempt_or_pass';
		const snooze = Number(byKey.get('quiz_gate_snooze_minutes'));
		value = {
			policy,
			snoozeMinutes: Number.isFinite(snooze) && snooze >= 0 ? Math.min(snooze, 480) : DEFAULT_SNOOZE_MINUTES,
			escapePaths: parseEscapePaths(byKey.get('quiz_gate_escape_paths'))
		};
	} catch (err) {
		console.error('[quizGate] gagal baca app_settings training_lms (quiz_gate_*), pakai default:', err);
	}
	settingsCache = { at: Date.now(), value };
	return value;
}

// ── Snooze (jejak di gate_audit_log; dibaca ulang server-side, bukan localStorage) ─
interface SnoozeRow {
	record_id: string | null;
	payload_snapshot: { periode_ke?: number; snoozed_until?: string } | null;
}

async function loadSnoozes(email: string | null, quizIds: number[]): Promise<SnoozeRow[]> {
	if (!email || quizIds.length === 0) return [];
	try {
		const query = new URLSearchParams({
			'filter[gate][_eq]': QUIZ_GATE_KEY,
			'filter[user_email][_eq]': email,
			'filter[record_id][_in]': quizIds.join(','),
			'filter[reason][_starts_with]': 'SNOOZE',
			fields: 'record_id,payload_snapshot',
			sort: '-id',
			limit: '50'
		});
		const res = await directusServerJson<{ data: SnoozeRow[] }>(`/items/gate_audit_log?${query.toString()}`);
		return res?.data || [];
	} catch (err) {
		console.error('[quizGate] gagal baca snooze gate_audit_log (dianggap belum ada):', err);
		return [];
	}
}

/** Dispensasi admin (gate_audit_log reason 'DISPENSASI…', payload {karyawan_id, periode_ke}) untuk karyawan ini. */
export async function loadDispensasi(karyawanId: number, quizIds: number[]): Promise<Array<{ quizId: number; periodeKe: number }>> {
	if (quizIds.length === 0) return [];
	try {
		const query = new URLSearchParams({
			'filter[gate][_eq]': QUIZ_GATE_KEY,
			'filter[record_id][_in]': quizIds.join(','),
			'filter[reason][_starts_with]': 'DISPENSASI',
			fields: 'record_id,payload_snapshot',
			sort: '-id',
			limit: '300'
		});
		const res = await directusServerJson<{ data: Array<{ record_id: string | null; payload_snapshot: { karyawan_id?: number; periode_ke?: number } | null }> }>(
			`/items/gate_audit_log?${query.toString()}`
		);
		return (res?.data || [])
			.filter((r) => Number(r.payload_snapshot?.karyawan_id) === Number(karyawanId))
			.map((r) => ({ quizId: Number(r.record_id), periodeKe: Number(r.payload_snapshot?.periode_ke ?? 1) }));
	} catch (err) {
		console.error('[quizGate] gagal baca dispensasi gate_audit_log (dianggap tidak ada):', err);
		return [];
	}
}

/** Murni: snooze mana yang berlaku untuk (quiz, periode) + apakah jatah tunda periode itu sudah terpakai. */
export function summarizeSnoozes(rows: SnoozeRow[], pending: Array<{ quizId: number; periodeKe: number }>, nowMs: number) {
	let used = false;
	let minUntil: number | null = null;
	let allCovered = pending.length > 0;
	for (const p of pending) {
		const mine = rows.filter((r) => String(r.record_id) === String(p.quizId) && Number(r.payload_snapshot?.periode_ke ?? 1) === p.periodeKe);
		if (mine.length > 0) used = true;
		const untils = mine.map((r) => new Date(r.payload_snapshot?.snoozed_until || 0).getTime()).filter((t) => t > nowMs);
		if (untils.length === 0) { allCovered = false; continue; }
		const best = Math.max(...untils);
		minUntil = minUntil == null ? best : Math.min(minUntil, best);
	}
	return { snoozeUsed: used, snoozedUntilMs: allCovered ? minUntil : null };
}

// ── Evaluasi utama ───────────────────────────────────────────────────────────
export async function getQuizGateStatus(
	karyawan: { id: number; divisi_id: number | null },
	email: string | null,
	nowMs: number = Date.now()
): Promise<QuizGateStatus> {
	let all: PeriodicQuizRow[];
	try {
		all = await loadMandatoryQuizzes();
	} catch (err) {
		console.error('[quizGate] gagal membaca kuis wajib-gate (fail-open):', err);
		return { ...EMPTY_QUIZ_GATE };
	}

	// 0 query tambahan bila tak ada kuis aktif / segera dibuka.
	const aktif = all.filter((q) => isGateWindowActive(q, nowMs));
	const segera = all.filter((q) => {
		const d = daysUntilStart(q, nowMs);
		return d != null && d <= Math.max(1, Number(q.prep_notify_days) || 7);
	});
	if (aktif.length === 0 && segera.length === 0) return { ...EMPTY_QUIZ_GATE };

	const mode = (await resolveGateMode(QUIZ_GATE_KEY, QUIZ_GATE_DOCUMENT_TYPE)) as QuizGateMode;
	if (mode === 'shadow') return { ...EMPTY_QUIZ_GATE, mode };

	const settings = await getQuizGateSettings();
	try {
		const upcoming: QuizGateUpcoming[] = [];
		for (const q of segera) {
			if (quizTargetScope(q, karyawan) === 'not_targeted') continue;
			upcoming.push({ quizId: q.id, programId: q.program_id, judul: q.judul, tanggalMulai: String(q.tanggal_mulai), hariLagi: daysUntilStart(q, nowMs) ?? 0 });
		}

		const items: QuizGateItem[] = [];
		const relevan = aktif.filter((q) => quizTargetScope(q, karyawan) !== 'not_targeted');
		if (relevan.length > 0) {
			const programIds = [...new Set(relevan.map((q) => q.program_id))];
			const enrRes = await directusServerJson<{ data: Array<{ id: number; program_id: number }> }>(
				`/items/training_enrollment?${new URLSearchParams({
					'filter[karyawan_id][_eq]': String(karyawan.id),
					'filter[program_id][_in]': programIds.join(','),
					fields: 'id,program_id',
					limit: '-1'
				}).toString()}`
			);
			const enrollByProgram = new Map<number, number>((enrRes?.data || []).map((e) => [Number(e.program_id), e.id]));

			// JIT: target spesifik tapi belum terdaftar → daftarkan sekarang (tak menunggu sapuan n8n).
			for (const q of relevan) {
				if (enrollByProgram.has(q.program_id) || quizTargetScope(q, karyawan) !== 'targeted') continue;
				try {
					const e = await ensureEnrollmentForTargetedQuiz(karyawan.id, q.program_id);
					if (e) enrollByProgram.set(q.program_id, e.id);
				} catch (err) {
					console.error('[quizGate] JIT enroll gagal (non-fatal):', q.program_id, err);
				}
			}

			const mine = relevan.filter((q) => enrollByProgram.has(q.program_id));
			if (mine.length > 0) {
				const enrollIds = [...new Set(mine.map((q) => enrollByProgram.get(q.program_id)!))];
				const [attRes, maxAttempts] = await Promise.all([
					directusServerJson<{ data: Array<{ enrollment_id: number; quiz_id: number; lulus: boolean | null; periode_ke: number | null }> }>(
						`/items/training_quiz_attempt?${new URLSearchParams({
							'filter[enrollment_id][_in]': enrollIds.join(','),
							'filter[quiz_id][_in]': mine.map((q) => q.id).join(','),
							fields: 'enrollment_id,quiz_id,lulus,periode_ke',
							limit: '-1'
						}).toString()}`
					),
					fetchMaxQuizAttempts()
				]);
				const attempts = attRes?.data || [];
				const dispensasi = await loadDispensasi(karyawan.id, mine.map((q) => q.id));
				for (const q of mine) {
					const enrId = enrollByProgram.get(q.program_id)!;
					const periode = quizPeriode(q);
					const mineAttempts = attempts.filter((a) => Number(a.enrollment_id) === enrId && Number(a.quiz_id) === q.id);
					const dispensed = dispensasi.some((d) => d.quizId === q.id && d.periodeKe === periode);
					const { state, used } = resolveQuizPeriodState(attemptsInPeriod(mineAttempts, periode), periode, maxAttempts, settings.policy, dispensed);
					items.push({
						quizId: q.id, programId: q.program_id, judul: q.judul, periodeKe: periode, state, attemptsUsed: used,
						maxAttempts, tanggalSelesai: q.tanggal_selesai, durasiMenit: q.durasi_menit, ringkasanPoin: cleanRingkasan(q.ringkasan_poin)
					});
				}
			}
		}

		const pending = items.filter((i) => i.state === 'pending');
		const snoozeRows = mode === 'soft' && pending.length > 0 ? await loadSnoozes(email, pending.map((p) => p.quizId)) : [];
		const { snoozeUsed, snoozedUntilMs } = summarizeSnoozes(snoozeRows, pending, nowMs);
		const decision = decideQuizGate({
			mode, items: items.map((i) => ({ quizId: i.quizId, state: i.state })),
			snoozeMinutes: settings.snoozeMinutes, snoozedUntilMs, nowMs
		});

		return {
			mode,
			blocking: decision.blocking,
			showBanner: decision.showBanner,
			canSnooze: decision.canSnooze && !snoozeUsed,
			snoozeMinutes: settings.snoozeMinutes,
			snoozedUntil: snoozedUntilMs ? new Date(snoozedUntilMs).toISOString() : null,
			pendingCount: decision.pendingCount,
			unlockPolicy: settings.policy,
			escapePaths: settings.escapePaths,
			// Kunci "soft" yang jatah tundanya sudah habis tetap blocking (canSnooze=false) — bukan terbuka.
			items,
			upcoming
		};
	} catch (err) {
		console.error('[quizGate] gagal mengevaluasi gate kuis (fail-open):', err);
		return { ...EMPTY_QUIZ_GATE, mode, escapePaths: settings.escapePaths };
	}
}

/**
 * Tunda darurat (hanya mode soft, 1× per periode per kuis). Alasan wajib ≥ 10 karakter; tercatat di gate_audit_log
 * (ditulis SINKRON — bila gagal, tunda ditolak supaya tidak ada tunda tanpa jejak).
 */
export async function snoozeQuizGate(
	karyawan: { id: number; divisi_id: number | null },
	email: string | null,
	alasan: string,
	nowMs: number = Date.now()
): Promise<{ snoozedUntil: string }> {
	const reason = (alasan || '').trim();
	if (reason.length < 10) throw Object.assign(new Error('Alasan darurat minimal 10 karakter.'), { status: 400 });

	const status = await getQuizGateStatus(karyawan, email, nowMs);
	if (status.mode !== 'soft') throw Object.assign(new Error('Tunda hanya tersedia pada mode gate soft.'), { status: 409 });
	if (!status.canSnooze) throw Object.assign(new Error('Tunda tidak tersedia (jatah periode ini sudah terpakai, atau dinonaktifkan).'), { status: 409 });

	const until = new Date(nowMs + status.snoozeMinutes * 60_000).toISOString();
	for (const item of status.items.filter((i) => i.state === 'pending')) {
		await directusServerJson('/items/gate_audit_log', {
			method: 'POST',
			body: JSON.stringify({
				gate: QUIZ_GATE_KEY,
				collection: 'training_quiz',
				method: 'POST',
				record_id: String(item.quizId),
				decision: 'allow',
				reason: `SNOOZE: ${reason}`.slice(0, 500),
				payload_snapshot: { periode_ke: item.periodeKe, snoozed_until: until, karyawan_id: karyawan.id, snooze_minutes: status.snoozeMinutes },
				user_email: email
			})
		});
	}
	return { snoozedUntil: until };
}
