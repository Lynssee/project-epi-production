import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { findModuleById, findMyEnrollmentForProgram, upsertModuleProgress } from '$lib/server/ess/training';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => null);

	const moduleId = Number(body?.moduleId);
	const persenDitonton = Number(body?.persenDitonton);
	const detikDitonton = Number(body?.detikDitonton);
	const durasiVideo = body?.durasiVideo != null ? Number(body.durasiVideo) : null;
	const segmenDitonton = Array.isArray(body?.segmenDitonton) ? body.segmenDitonton : [];
	const lastPosition = Number(body?.lastPosition) || 0;

	if (!Number.isFinite(moduleId)) throw error(400, 'Modul tidak valid.');
	if (!Number.isFinite(persenDitonton) || !Number.isFinite(detikDitonton)) throw error(400, 'Data progress tidak valid.');

	const mod = await findModuleById(moduleId);
	if (!mod) throw error(404, 'Modul tidak ditemukan.');

	// Kepemilikan: enrollment untuk program modul ini HARUS milik karyawan yang login.
	const enrollment = await findMyEnrollmentForProgram(karyawan.id, mod.program_id);
	if (!enrollment) throw error(403, 'Anda belum terdaftar di kursus ini.');

	try {
		const saved = await upsertModuleProgress(enrollment, mod, {
			persenDitonton,
			detikDitonton,
			durasiVideo,
			segmenDitonton,
			lastPosition,
			manual: body?.manual === true
		});
		return json({ progress: saved });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal menyimpan progress.');
	}
};
