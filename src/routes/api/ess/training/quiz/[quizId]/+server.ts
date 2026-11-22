import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import {
	findQuizById,
	listQuestionsSafe,
	findMyEnrollmentForProgram,
	ensureEnrollmentForTargetedQuiz,
	attemptsInPeriod,
	listMyAttempts,
	listModulesByProgram,
	listProgressByEnrollment,
	submitQuizAttemptSafe,
	fetchMaxQuizAttempts,
	fetchQuizDisplaySettings,
	createQuizSessionToken,
	QuizRetakeBlockedError,
	type TrainingQuizRecord
} from '$lib/server/ess/training';
import { getQuizGateSettings } from '$lib/server/ess/quizGate';
import { isFinalQuizRetakeBlocked, PESAN_KUIS_AKHIR_SUDAH_LULUS } from '$lib/utils/trainingGuards';
import {
	isPeriodicQuiz,
	isQuizWindowActive,
	quizPeriode,
	quizSampleSeed,
	quizTargetScope,
	resolveQuizPeriodState,
	sampleQuestionIds,
	type PeriodicQuizRow
} from '$lib/utils/quizPeriodic';
import { findSopByProgramId } from '$lib/server/ess/sop';
import { evaluateRetryGate, getSignoffMode, loadSignoffCount, onRetryLimitReached, resolveMentorOf } from '$lib/server/ess/mentorSignoff';

const asPeriodic = (q: TrainingQuizRecord) => q as unknown as PeriodicQuizRow;

/** Periode buka/tutup kuis ditegakkan di server (kolom kosong = selalu buka, perilaku lama). */
function assertWindowOpen(quiz: TrainingQuizRecord) {
	if (isQuizWindowActive(asPeriodic(quiz))) return;
	const mulai = quiz.tanggal_mulai ? new Date(quiz.tanggal_mulai) : null;
	if (mulai && mulai.getTime() > Date.now()) {
		throw error(403, `Kuis ini belum dibuka. Dibuka pada ${mulai.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' })} WIB.`);
	}
	throw error(403, 'Periode kuis ini sudah ditutup.');
}

/** Enrollment peserta; target kuis periodik yang belum terdaftar didaftarkan JIT (tanpa menunggu sapuan n8n). */
async function resolveEnrollment(karyawan: { id: number; divisi_id: number | null }, quiz: TrainingQuizRecord) {
	const enrollment = await findMyEnrollmentForProgram(karyawan.id, quiz.program_id);
	if (enrollment) return enrollment;
	if (isPeriodicQuiz(asPeriodic(quiz)) && quizTargetScope(asPeriodic(quiz), karyawan) === 'targeted') {
		const jit = await ensureEnrollmentForTargetedQuiz(karyawan.id, quiz.program_id);
		if (jit) return jit;
	}
	throw error(403, 'Anda belum terdaftar di kursus ini.');
}

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const quizId = Number(event.params.quizId);
	if (!Number.isFinite(quizId)) throw error(400, 'Kuis tidak valid.');

	const quiz = await findQuizById(quizId);
	if (!quiz) throw error(404, 'Kuis tidak ditemukan.');
	assertWindowOpen(quiz);

	const enrollment = await resolveEnrollment(karyawan, quiz);
	const periodik = isPeriodicQuiz(asPeriodic(quiz));

	// Gating kuis akhir: kunci sampai semua modul berstatus Selesai — kecuali admin mengizinkan bypass (kuis mingguan).
	if (!quiz.module_id && !quiz.bypass_module_lock) {
		const [modules, progress] = await Promise.all([listModulesByProgram(quiz.program_id), listProgressByEnrollment(enrollment.id)]);
		const semuaSelesai = modules.every((m) => progress.find((p) => p.module_id === m.id)?.status === 'Selesai');
		if (!semuaSelesai) throw error(400, 'Selesaikan semua modul terlebih dahulu sebelum mengerjakan kuis akhir.');
	}

	const [allQuestions, allAttempts, displaySettings, sopTerkait, gateSettings] = await Promise.all([
		listQuestionsSafe(quizId),
		listMyAttempts(enrollment.id, quizId),
		fetchQuizDisplaySettings(),
		findSopByProgramId(quiz.program_id),
		periodik ? getQuizGateSettings() : Promise.resolve(null)
	]);

	const periode = quizPeriode(quiz);
	const attempts = periodik ? attemptsInPeriod(allAttempts, periode) : allAttempts;

	// Sign-off atasan/mentor (G_TRN_MENTOR_SIGNOFF) menambah batas efektif. Query tambahan HANYA bila sudah di batas dasar (kasus jarang).
	const batasDasar = displaySettings.maxAttempts;
	const lulusDiPeriode = attempts.some((a) => a.lulus === true);
	const signoffs = attempts.length >= batasDasar ? await loadSignoffCount(enrollment.id, quizId, periodik ? periode : 0) : 0;
	const batasEfektif = batasDasar + signoffs;
	const mentorInfo = attempts.length >= batasEfektif && !lulusDiPeriode ? await resolveMentorOf(karyawan.id) : null;

	// Bank soal → sampel deterministik per (karyawan, kuis, periode, percobaan ke-N): POST memakai seed yang sama.
	let questions = allQuestions;
	if (periodik && quiz.jumlah_soal_tampil) {
		const ids = new Set(
			sampleQuestionIds(allQuestions.map((q) => q.id), quiz.jumlah_soal_tampil, quizSampleSeed(karyawan.id, quiz.id, periode, attempts.length))
		);
		questions = allQuestions.filter((q) => ids.has(q.id));
	}

	let periodikInfo: Record<string, unknown> | null = null;
	if (periodik && gateSettings) {
		const { state } = resolveQuizPeriodState(attempts, periode, batasEfektif, gateSettings.policy);
		periodikInfo = {
			periodeKe: periode,
			state,
			tanggalMulai: quiz.tanggal_mulai ?? null,
			tanggalSelesai: quiz.tanggal_selesai ?? null,
			durasiMenit: quiz.durasi_menit ?? null,
			jumlahSoal: questions.length,
			bankSoal: allQuestions.length
		};
	}

	// Flashcard persiapan 1 menit (opsional): hanya array teks tak kosong, maks 8 poin.
	const rp: unknown = quiz.ringkasan_poin;
	const ringkasanPoin = (Array.isArray(rp) ? rp : [])
		.map((x) => String(x ?? '').trim())
		.filter(Boolean)
		.slice(0, 8);

	const nowMs = Date.now();
	const sessionToken = createQuizSessionToken(karyawan.id, quiz.id, nowMs);

	return json({
		quiz,
		questions,
		attempts,
		sessionToken,
		serverTime: new Date(nowMs).toISOString(),
		maxAttempts: batasEfektif,
		// Info pembinaan: batas tercapai & belum lulus → klien menampilkan siapa yang dapat menyetujui percobaan ulang.
		perluPembinaan: mentorInfo ? { mentorNama: mentorInfo.nama } : attempts.length >= batasEfektif && !lulusDiPeriode ? { mentorNama: null } : null,
		showAnswersAfter: displaySettings.showAnswersAfter,
		sopTerkait,
		periodik: periodikInfo,
		ringkasanPoin,
		// Klien menyembunyikan form kuis bila sudah Lulus (server tetap menolak 409). Kuis periodik: lulus di PERIODE INI saja.
		sudahLulus: periodik ? periodikInfo?.state === 'done' : isFinalQuizRetakeBlocked(quiz, enrollment.status)
	});
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const quizId = Number(event.params.quizId);
	if (!Number.isFinite(quizId)) throw error(400, 'Kuis tidak valid.');

	const quiz = await findQuizById(quizId);
	if (!quiz) throw error(404, 'Kuis tidak ditemukan.');
	assertWindowOpen(quiz);

	const enrollment = await resolveEnrollment(karyawan, quiz);
	const periodik = isPeriodicQuiz(asPeriodic(quiz));

	// Sudah Lulus → kuis akhir tidak boleh dikerjakan ulang (nilai & sertifikat resmi tidak ditimpa).
	// Kuis formatif per modul (module_id terisi) tetap boleh diulang; kuis periodik dibatasi per periode (di bawah).
	if (!periodik && isFinalQuizRetakeBlocked(quiz, enrollment.status)) throw error(409, PESAN_KUIS_AKHIR_SUDAH_LULUS);

	const body = await event.request.json().catch(() => null);
	const jawaban = Array.isArray(body?.jawaban) ? body.jawaban : [];
	if (jawaban.length === 0) throw error(400, 'Jawaban tidak boleh kosong.');
	const sessionToken = typeof body?.session_token === 'string' ? body.session_token : undefined;
	const tabSwitchCount = typeof body?.tab_switch_count === 'number' ? body.tab_switch_count : 0;
	const clientStartedAt = typeof body?.client_started_at === 'number' ? body.client_started_at : undefined;

	// Batas percobaan WAJIB divalidasi di server (bukan hanya UI) — ini sertifikat kompetensi,
	// validasi klien saja bisa ditembus lewat DevTools. Gerbang 4.1: terkunci sampai HRD reset
	// (lihat HrdTrainingEvaluation.svelte "Reset Percobaan" di admin).
	const [maxAttempts, allAttempts] = await Promise.all([fetchMaxQuizAttempts(), listMyAttempts(enrollment.id, quizId)]);
	const existingAttempts = periodik ? attemptsInPeriod(allAttempts, quizPeriode(quiz)) : allAttempts;
	if (periodik && existingAttempts.some((a) => a.lulus === true)) {
		throw error(409, 'Anda sudah lulus kuis periode ini. Kuis berikutnya dibuka pada periode selanjutnya.');
	}
	const signoffs = existingAttempts.length >= maxAttempts ? await loadSignoffCount(enrollment.id, quizId, periodik ? quizPeriode(quiz) : 0) : 0;
	const gate = evaluateRetryGate({
		mode: existingAttempts.length >= maxAttempts ? await getSignoffMode() : 'shadow',
		attempts: existingAttempts.length, maxAttempts, signoffs
	});
	if (!gate.allow) {
		// Batas efektif (maks + sign-off atasan) tercapai: catat/ingatkan sesuai mode gate, lalu tolak seperti sebelumnya (batas lama tak pernah dilonggarkan oleh mode).
		const { mentor } = await onRetryLimitReached({
			mode: await getSignoffMode(), result: gate, enrollmentId: enrollment.id, quizId, quizJudul: (quiz as { judul?: string }).judul ?? null,
			periodeKe: periodik ? quizPeriode(quiz) : 0, karyawan: karyawan as any, attempts: existingAttempts.length
		});
		const saran = mentor?.nama ? ` Anda juga dapat meminta ${mentor.nama} (atasan/mentor Anda) menyetujui percobaan ulang setelah pembinaan.` : '';
		throw error(403, `Batas ${gate.effectiveMax} percobaan untuk kuis ini sudah tercapai. ${periodik ? 'Periode berikutnya Anda bisa mengerjakan lagi; HRD dapat memberi dispensasi bila perlu.' : 'Hubungi HRD untuk mengulang.'}${saran}`);
	}
	try {
		const attempt = await submitQuizAttemptSafe(
			enrollment,
			quiz,
			jawaban,
			{ karyawanId: karyawan.id, attemptIndex: existingAttempts.length },
			{ sessionToken, tabSwitchCount, clientStartedAt }
		);
		const terpakai = existingAttempts.length + 1;
		const habis = attempt?.lulus !== true && terpakai >= gate.effectiveMax;
		if (habis) {
			// Percobaan terakhir gagal: atasan/mentor langsung diberi tahu (tidak menunggu bawahan mencoba lagi). Dedup di onRetryLimitReached.
			const mode = await getSignoffMode();
			void onRetryLimitReached({
				mode, result: { ...gate, atLimit: true, allow: false, decision: mode === 'shadow' ? 'shadow' : mode === 'hard' ? 'block' : 'warn', remindMentor: mode !== 'shadow' },
				enrollmentId: enrollment.id, quizId, quizJudul: (quiz as { judul?: string }).judul ?? null, periodeKe: periodik ? quizPeriode(quiz) : 0,
				karyawan: karyawan as any, attempts: terpakai
			});
		}
		return json({
			attempt,
			// Percobaan habis tanpa lulus pada kuis periodik → klien menampilkan "Perlu Remedial" (kunci dibuka sesuai kebijakan).
			remedial: periodik && habis
		});
	} catch (e) {
		// Penjaga kedua (status dibaca ulang di server) — mis. submit ganda hampir bersamaan.
		if (e instanceof QuizRetakeBlockedError) throw error(409, e.message);
		throw e;
	}
};
