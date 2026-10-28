import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import {
	findQuizById,
	listQuestionsSafe,
	findMyEnrollmentForProgram,
	listMyAttempts,
	listModulesByProgram,
	listProgressByEnrollment,
	submitQuizAttemptSafe,
	fetchMaxQuizAttempts,
	fetchQuizDisplaySettings,
	QuizRetakeBlockedError
} from '$lib/server/ess/training';
import { isFinalQuizRetakeBlocked, PESAN_KUIS_AKHIR_SUDAH_LULUS } from '$lib/utils/trainingGuards';
import { findSopByProgramId } from '$lib/server/ess/sop';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const quizId = Number(event.params.quizId);
	if (!Number.isFinite(quizId)) throw error(400, 'Kuis tidak valid.');

	const quiz = await findQuizById(quizId);
	if (!quiz) throw error(404, 'Kuis tidak ditemukan.');

	const enrollment = await findMyEnrollmentForProgram(karyawan.id, quiz.program_id);
	if (!enrollment) throw error(403, 'Anda belum terdaftar di kursus ini.');

	// Gating kuis akhir: kunci sampai semua modul berstatus Selesai.
	if (!quiz.module_id) {
		const [modules, progress] = await Promise.all([listModulesByProgram(quiz.program_id), listProgressByEnrollment(enrollment.id)]);
		const semuaSelesai = modules.every((m) => progress.find((p) => p.module_id === m.id)?.status === 'Selesai');
		if (!semuaSelesai) throw error(400, 'Selesaikan semua modul terlebih dahulu sebelum mengerjakan kuis akhir.');
	}

	const [questions, attempts, displaySettings, sopTerkait] = await Promise.all([
		listQuestionsSafe(quizId),
		listMyAttempts(enrollment.id, quizId),
		fetchQuizDisplaySettings(),
		findSopByProgramId(quiz.program_id)
	]);

	return json({
		quiz,
		questions,
		attempts,
		maxAttempts: displaySettings.maxAttempts,
		showAnswersAfter: displaySettings.showAnswersAfter,
		sopTerkait,
		// Klien menyembunyikan form kuis akhir bila enrollment sudah Lulus (server tetap menolak 409).
		sudahLulus: isFinalQuizRetakeBlocked(quiz, enrollment.status)
	});
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const quizId = Number(event.params.quizId);
	if (!Number.isFinite(quizId)) throw error(400, 'Kuis tidak valid.');

	const quiz = await findQuizById(quizId);
	if (!quiz) throw error(404, 'Kuis tidak ditemukan.');

	const enrollment = await findMyEnrollmentForProgram(karyawan.id, quiz.program_id);
	if (!enrollment) throw error(403, 'Anda belum terdaftar di kursus ini.');

	// Sudah Lulus → kuis akhir tidak boleh dikerjakan ulang (nilai & sertifikat resmi tidak ditimpa).
	// Kuis formatif per modul (module_id terisi) tetap boleh diulang. Dicek sebelum batas percobaan
	// supaya pesan yang muncul ramah, bukan "hubungi HRD".
	if (isFinalQuizRetakeBlocked(quiz, enrollment.status)) throw error(409, PESAN_KUIS_AKHIR_SUDAH_LULUS);

	const body = await event.request.json().catch(() => null);
	const jawaban = Array.isArray(body?.jawaban) ? body.jawaban : [];
	if (jawaban.length === 0) throw error(400, 'Jawaban tidak boleh kosong.');

	// Batas percobaan WAJIB divalidasi di server (bukan hanya UI) — ini sertifikat kompetensi,
	// validasi klien saja bisa ditembus lewat DevTools. Gerbang 4.1: terkunci sampai HRD reset
	// (lihat HrdTrainingEvaluation.svelte "Reset Percobaan" di admin).
	const [maxAttempts, existingAttempts] = await Promise.all([fetchMaxQuizAttempts(), listMyAttempts(enrollment.id, quizId)]);
	if (existingAttempts.length >= maxAttempts) {
		throw error(403, `Batas ${maxAttempts} percobaan untuk kuis ini sudah tercapai. Hubungi HRD untuk mengulang.`);
	}

	try {
		const attempt = await submitQuizAttemptSafe(enrollment, quiz, jawaban);
		return json({ attempt });
	} catch (e) {
		// Penjaga kedua (status dibaca ulang di server) — mis. submit ganda hampir bersamaan.
		if (e instanceof QuizRetakeBlockedError) throw error(409, e.message);
		throw e;
	}
};
