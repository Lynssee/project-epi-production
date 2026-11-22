import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listCatalogForKaryawan } from '$lib/server/ess/training';
import {
	gradeMicro, loadModuleQuestionsFull, makeMicroToken, pickMicroQuestions, resolveMicroCount, toPublic, verifyMicroToken
} from '$lib/server/ess/trainingMicroQuiz';
import { getShortcutMap } from '$lib/server/ess/trainingShortcut';

// Micro-quiz latihan (tanpa catatan skor). GET ?program=ID&konteks=K → soal acak TANPA kunci + token.
// POST { program, token, answers:{[id]:jawaban} } → hasil per soal + kunci HANYA untuk soal yang disajikan token.
async function ensureVisible(karyawan: { divisi: string | null; divisi_id: number | null }, programId: number) {
	const programs = await listCatalogForKaryawan(karyawan.divisi, karyawan.divisi_id);
	if (!programs.some((p) => p.id === programId)) throw error(404, 'Kursus tidak ditemukan');
}

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const programId = Number(event.url.searchParams.get('program'));
	const konteks = (event.url.searchParams.get('konteks') || '').trim().toLowerCase();
	if (!Number.isInteger(programId) || programId <= 0) throw error(400, 'program tidak valid');
	if (!/^[a-z0-9_-]{1,40}$/.test(konteks)) throw error(400, 'konteks tidak valid');

	const rule = (await getShortcutMap())[konteks];
	const count = resolveMicroCount((rule as any)?.micro_quiz);
	if (!rule || count === 0) return json({ questions: [], token: null });
	await ensureVisible(karyawan, programId);

	const picked = pickMicroQuestions(await loadModuleQuestionsFull(programId), count);
	if (!picked.length) return json({ questions: [], token: null });
	return json({ questions: picked.map(toPublic), token: makeMicroToken(karyawan.id, programId, picked.map((q) => q.id)) });
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	let body: any;
	try { body = await event.request.json(); } catch { throw error(400, 'Body harus JSON'); }
	const programId = Number(body?.program);
	if (!Number.isInteger(programId) || programId <= 0) throw error(400, 'program tidak valid');
	const ids = verifyMicroToken(body?.token, karyawan.id, programId);
	if (!ids?.length) throw error(400, 'Sesi latihan tidak valid atau kedaluwarsa — muat ulang soal.');

	const served = (await loadModuleQuestionsFull(programId)).filter((q) => ids.includes(q.id));
	return json(gradeMicro(served, body?.answers && typeof body.answers === 'object' ? body.answers : {}));
};
