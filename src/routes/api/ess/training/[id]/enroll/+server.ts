import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { findProgramById, enrollSelf } from '$lib/server/ess/training';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const programId = Number(event.params.id);
	if (!Number.isFinite(programId)) throw error(400, 'ID kursus tidak valid.');

	const program = await findProgramById(programId);
	if (!program || program.status !== 'published') throw error(404, 'Kursus tidak ditemukan.');

	try {
		const enrollment = await enrollSelf(karyawan.id, program);
		return json({ enrollment });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal mendaftar kursus.');
	}
};
