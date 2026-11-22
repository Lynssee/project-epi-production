// src/lib/utils/quizPeriodic.ts
// Aturan MURNI kuis periodik (asynchronous terjadwal) + App-Blocking Gate G_TRN_QUIZ_PERIODIC_WAJIB.
// Tanpa I/O / $env: dipakai server (quizGate.ts, route kuis) dan klien (layout, banner), dan mudah diuji.
// Mode gate (shadow/warn/soft/hard), kebijakan buka kunci, durasi snooze, dan escape path SEMUA dari pengaturan
// (gate_definitions + app_settings training_lms) — di sini hanya logika keputusan, tanpa hardcode ambang.

export type RecurrenceType = 'once' | 'weekly' | 'biweekly' | 'monthly';
export type QuizGateMode = 'shadow' | 'warn' | 'soft' | 'hard';
export type UnlockPolicy = 'pass_only' | 'attempt_or_pass';
export type QuizPeriodState = 'pending' | 'remedial' | 'done' | 'dispensed';

export interface PeriodicQuizRow {
	id: number;
	program_id: number;
	module_id: number | null;
	judul: string;
	passing_score: number | null;
	acak_soal?: boolean | null;
	tanggal_mulai: string | null;
	tanggal_selesai: string | null;
	durasi_menit: number | null;
	/** Ringkasan poin materi sebelum kuis (opsional; dibersihkan cleanRingkasan di quizGate). */
	ringkasan_poin?: unknown;
	is_mandatory_gate: boolean | null;
	bypass_module_lock: boolean | null;
	recurrence_type: RecurrenceType | string | null;
	prep_notify_days: number | null;
	jumlah_soal_tampil: number | null;
	target_divisi_ids: unknown;
	target_karyawan_ids: unknown;
	periode_ke: number | null;
}

export const DEFAULT_ESCAPE_PATHS = ['/ess/absen', '/ess/kehadiran', '/ess/izin-sakit', '/ess/pelatihan', '/site-checkin'];
export const DEFAULT_UNLOCK_POLICY: UnlockPolicy = 'attempt_or_pass';
export const DEFAULT_SNOOZE_MINUTES = 60;

/** Kuis periodik = ditandai wajib-gate ATAU berulang. Kuis periodik tidak pernah mengubah status/sertifikat enrollment. */
export function isPeriodicQuiz(q: Pick<PeriodicQuizRow, 'is_mandatory_gate' | 'recurrence_type'> | null | undefined): boolean {
	if (!q) return false;
	return q.is_mandatory_gate === true || (!!q.recurrence_type && q.recurrence_type !== 'once');
}

/** Periode kuis = periode_ke (default 1 untuk data lama / null). */
export function quizPeriode(q: { periode_ke?: number | null } | null | undefined): number {
	const n = Number(q?.periode_ke);
	return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Attempt lama (sebelum kolom periode_ke ada) dianggap periode 1. */
export function attemptPeriode(a: { periode_ke?: number | null } | null | undefined): number {
	return quizPeriode(a);
}

function ms(v: string | null | undefined): number | null {
	if (!v) return null;
	const t = new Date(v).getTime();
	return Number.isNaN(t) ? null : t;
}

/** Jendela buka kuis. Tanggal kosong = tidak dibatasi di sisi itu. */
export function isQuizWindowActive(q: Pick<PeriodicQuizRow, 'tanggal_mulai' | 'tanggal_selesai'>, nowMs: number = Date.now()): boolean {
	const mulai = ms(q.tanggal_mulai);
	const selesai = ms(q.tanggal_selesai);
	if (mulai != null && nowMs < mulai) return false;
	if (selesai != null && nowMs > selesai) return false;
	return true;
}

/** Gate hanya berlaku bila periode punya tanggal_mulai eksplisit (kuis tanpa jadwal tidak pernah mengunci aplikasi). */
export function isGateWindowActive(q: Pick<PeriodicQuizRow, 'tanggal_mulai' | 'tanggal_selesai'>, nowMs: number = Date.now()): boolean {
	return ms(q.tanggal_mulai) != null && isQuizWindowActive(q, nowMs);
}

/** Sisa hari (pembulatan ke atas) sampai tanggal_mulai; null bila tak ada tanggal / sudah lewat. */
export function daysUntilStart(q: Pick<PeriodicQuizRow, 'tanggal_mulai'>, nowMs: number = Date.now()): number | null {
	const mulai = ms(q.tanggal_mulai);
	if (mulai == null || mulai <= nowMs) return null;
	return Math.ceil((mulai - nowMs) / 86_400_000);
}

export function parseIdList(raw: unknown): number[] {
	let arr: unknown = raw;
	if (typeof raw === 'string') {
		const t = raw.trim();
		if (!t) return [];
		try {
			arr = t.startsWith('[') ? JSON.parse(t) : t.split(',');
		} catch {
			return [];
		}
	}
	if (!Array.isArray(arr)) return [];
	return arr.map((x) => Number(typeof x === 'object' && x ? (x as any).id : x)).filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Apakah karyawan menjadi target kuis ini?
 * - target_karyawan_ids terisi → hanya mereka;  - else target_divisi_ids terisi → divisi_id cocok;
 * - keduanya kosong → 'program' (ikut peserta program: hanya yang sudah/akan terdaftar di program).
 */
export function quizTargetScope(q: Pick<PeriodicQuizRow, 'target_divisi_ids' | 'target_karyawan_ids'>, karyawan: { id: number; divisi_id: number | null }): 'targeted' | 'not_targeted' | 'program' {
	const kar = parseIdList(q.target_karyawan_ids);
	if (kar.length > 0) return kar.includes(Number(karyawan.id)) ? 'targeted' : 'not_targeted';
	const div = parseIdList(q.target_divisi_ids);
	if (div.length > 0) return karyawan.divisi_id != null && div.includes(Number(karyawan.divisi_id)) ? 'targeted' : 'not_targeted';
	return 'program';
}

// ── Sampling soal deterministik (anti-bocor tanpa state) ─────────────────────
function hashSeed(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
function mulberry32(a: number) {
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Pilih n id soal dari bank soal secara deterministik: seed = karyawan+kuis+periode+nomor percobaan.
 * GET (tampil) dan POST (nilai) memakai seed sama → server tahu persis soal mana yang disajikan tanpa menyimpan state.
 * n kosong/≥ jumlah soal → semua soal (urutan asli).
 */
export function sampleQuestionIds(allIds: number[], n: number | null | undefined, seed: string): number[] {
	const ids = [...allIds].sort((a, b) => a - b);
	const k = Number(n);
	if (!Number.isFinite(k) || k < 1 || k >= ids.length) return ids;
	const rnd = mulberry32(hashSeed(seed));
	for (let i = ids.length - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		[ids[i], ids[j]] = [ids[j], ids[i]];
	}
	return ids.slice(0, k).sort((a, b) => a - b);
}

export function quizSampleSeed(karyawanId: number, quizId: number, periode: number, attemptIndex: number): string {
	return `${karyawanId}:${quizId}:${periode}:${attemptIndex}`;
}

// ── Status periode & keputusan gate ──────────────────────────────────────────
export interface PeriodAttemptLite {
	lulus: boolean | null;
	periode_ke?: number | null;
}

/**
 * Status kuis untuk periode berjalan seorang karyawan.
 * done = ada attempt lulus; dispensed = HRD/atasan memberi dispensasi periode ini (kunci dibuka manual);
 * remedial = (policy attempt_or_pass) percobaan habis tanpa lulus; selain itu pending.
 */
export function resolveQuizPeriodState(
	attempts: PeriodAttemptLite[],
	periode: number,
	maxAttempts: number,
	policy: UnlockPolicy,
	dispensed: boolean = false
): { state: QuizPeriodState; used: number } {
	const mine = attempts.filter((a) => attemptPeriode(a) === periode);
	const used = mine.length;
	if (mine.some((a) => a.lulus === true)) return { state: 'done', used };
	if (dispensed) return { state: 'dispensed', used };
	if (policy === 'attempt_or_pass' && maxAttempts >= 1 && used >= maxAttempts) return { state: 'remedial', used };
	return { state: 'pending', used };
}

export interface GateQuizItem {
	quizId: number;
	state: QuizPeriodState;
}

export interface QuizGateDecision {
	/** Layar kunci menutup halaman non-escape. */
	blocking: boolean;
	/** Banner pengingat (warn, atau soft/hard yang sedang ditunda / di halaman escape). */
	showBanner: boolean;
	/** soft + snooze > 0 + belum ditunda. */
	canSnooze: boolean;
	pendingCount: number;
}

/**
 * Keputusan akhir gate. shadow → tidak tampil apa pun. warn → banner. soft → kunci, bisa ditunda bila diizinkan.
 * hard → kunci tanpa tunda. Snooze aktif (snoozedUntilMs > now) menurunkan kunci jadi banner.
 */
export function decideQuizGate(opts: {
	mode: QuizGateMode;
	items: GateQuizItem[];
	snoozeMinutes: number;
	snoozedUntilMs: number | null;
	nowMs?: number;
}): QuizGateDecision {
	const now = opts.nowMs ?? Date.now();
	const pendingCount = opts.items.filter((i) => i.state === 'pending').length;
	if (pendingCount === 0 || opts.mode === 'shadow') return { blocking: false, showBanner: false, canSnooze: false, pendingCount };
	if (opts.mode === 'warn') return { blocking: false, showBanner: true, canSnooze: false, pendingCount };
	const snoozed = opts.snoozedUntilMs != null && opts.snoozedUntilMs > now;
	if (snoozed) return { blocking: false, showBanner: true, canSnooze: false, pendingCount };
	return { blocking: true, showBanner: false, canSnooze: opts.mode === 'soft' && opts.snoozeMinutes > 0, pendingCount };
}

export function parseEscapePaths(raw: unknown): string[] {
	const list = typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw : [];
	const out = list.map((p) => String(p).trim()).filter((p) => p.startsWith('/'));
	return out.length > 0 ? out : [...DEFAULT_ESCAPE_PATHS];
}

export function isEscapePath(pathname: string, escapePaths: string[]): boolean {
	return escapePaths.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : p + '/'));
}
