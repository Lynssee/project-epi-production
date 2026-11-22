import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getMicroQuiz, submitMicroQuiz, MicroQuizError } from '$lib/server/ess/microQuiz';

// GET  = soal Micro-Quiz hari ini untuk karyawan login (tanpa kunci jawaban) + status/ringkasan 7 hari.
// POST = { question_id, jawaban } — dinilai di server, dicatat 1x per hari.
export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	return json(await getMicroQuiz(karyawan as any));
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => null);
	if (!body || body.question_id == null) throw error(400, 'question_id wajib diisi.');
	try {
		return json(await submitMicroQuiz(karyawan as any, { questionId: body.question_id, jawaban: body.jawaban }));
	} catch (e) {
		if (e instanceof MicroQuizError) throw error(e.status, e.message);
		console.error('[api/ess/micro-quiz] POST gagal:', e);
		throw error(500, 'Gagal mencatat jawaban Micro-Quiz.');
	}
};
