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
import { getSumberConfig, sumberOfProgram } from '$lib/server/ess/trainingSource';
import { directusServerJson } from '$lib/server/directus';

/** Kartu 360° terkait (hanya program Inventory 360°): modul → barang. Relasi diambil terpisah; gagal = tanpa tombol, dilog. */
async function listKartu360(programId: number): Promise<Array<{ moduleId: number; itemId: number }>> {
	try {
		const mods = (await directusServerJson<{ data: Array<{ id: number; source_profile_id: number | null }> }>(`/items/training_module?filter[program_id][_eq]=${programId}&filter[source_profile_id][_nnull]=true&fields=id,source_profile_id&limit=100`))?.data || [];
		const ids = [...new Set(mods.map((m) => Number(m.source_profile_id)).filter((n) => Number.isFinite(n) && n > 0))];
		if (!ids.length) return [];
		const profs = (await directusServerJson<{ data: Array<{ id: number; item_id: number | null }> }>(`/items/inventory_knowledge_profile?filter[id][_in]=${ids.join(',')}&fields=id,item_id&limit=100`))?.data || [];
		const itemByProfile = new Map(profs.filter((p) => p.item_id != null).map((p) => [p.id, Number(p.item_id)]));
		return mods.flatMap((m) => {
			const itemId = itemByProfile.get(Number(m.source_profile_id));
			return itemId ? [{ moduleId: m.id, itemId }] : [];
		});
	} catch (e) {
		console.error('[ess/training] gagal memuat tautan Kartu 360°:', e);
		return [];
	}
}

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

	const isInv = /^TRN-INV-/i.test(program.kode || '');
	const [modules, enrollment, finalQuiz, sumberConfig, kartu360] = await Promise.all([
		listModulesByProgram(programId),
		findMyEnrollmentForProgram(karyawan.id, programId),
		findFinalQuizForProgram(programId),
		getSumberConfig(),
		isInv ? listKartu360(programId) : Promise.resolve([])
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
		sumber: sumberOfProgram(program, sumberConfig),
		kartu360,
		bisaSelfEnroll: !program.wajib && program.self_enroll && !enrollment
	});
};
