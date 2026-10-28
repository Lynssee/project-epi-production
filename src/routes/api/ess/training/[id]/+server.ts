import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import {
	findProgramById,
	listModulesByProgram,
	findMyEnrollmentForProgram,
	listProgressByEnrollment,
	findFinalQuizForProgram,
	autoEnrollWajib,
	getReadGateSettings
} from '$lib/server/ess/training';
import { computeMinReadSeconds } from '$lib/utils/trainingGuards';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const programId = Number(event.params.id);
	if (!Number.isFinite(programId)) throw error(400, 'ID kursus tidak valid.');

	const program = await findProgramById(programId);
	if (!program || program.status !== 'published') throw error(404, 'Kursus tidak ditemukan.');

	// JIT auto-enroll (Fase 1.1, Lapis 1): karyawan membuka onboarding/wajib tanpa enrollment
	// → server mendaftarkan otomatis di sini, sebelum modul & progres di-render.
	if (program.is_onboarding || program.wajib) {
		await autoEnrollWajib(karyawan.id, program);
	}

	const [modules, enrollment, finalQuiz] = await Promise.all([
		listModulesByProgram(programId),
		findMyEnrollmentForProgram(karyawan.id, programId),
		findFinalQuizForProgram(programId)
	]);

	const progress = enrollment ? await listProgressByEnrollment(enrollment.id) : [];
	const progressByModule = new Map(progress.map((p) => [p.module_id, p]));

	// Waktu baca minimum modul Teks/PDF/Link/Video-fallback (setelan training_lms, cache 5 menit) — dihitung server agar
	// hitung-mundur di klien identik dengan yang ditegakkan di POST /progress.
	const bacaSettings = await getReadGateSettings();
	const moduleList = modules.map((m) => ({
		modul: m,
		progress: progressByModule.get(m.id) || null,
		// manual:true → untuk Video nilai ini hanya dipakai bila pemutar tak terlacak (mode fallback di klien).
		minBacaDetik: computeMinReadSeconds(m, bacaSettings, { manual: true })
	}));

	return json({
		program,
		enrollment,
		modules: moduleList,
		finalQuizId: finalQuiz?.id ?? null,
		bisaSelfEnroll: !program.wajib && program.self_enroll && !enrollment
	});
};
