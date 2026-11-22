import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { findMyEnrollmentForProgram } from '$lib/server/ess/training';
import { getMyOutcomeView } from '$lib/server/ess/trainingOutcome';

// "Setelah training ini kamu bisa…" + "Hasil & Catatan Saya" untuk satu program. Hanya data milik karyawan yang login.
export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const programId = Number(event.params.id);
	if (!Number.isInteger(programId) || programId <= 0) throw error(400, 'ID kursus tidak valid.');
	try {
		const enrollment = await findMyEnrollmentForProgram(karyawan.id, programId);
		return json(await getMyOutcomeView(karyawan.id, programId, enrollment?.id ?? null));
	} catch (e) {
		console.error('[ess/training/outcome] gagal:', (e as Error)?.message);
		throw error(502, 'Gagal memuat outcome kursus.');
	}
};
