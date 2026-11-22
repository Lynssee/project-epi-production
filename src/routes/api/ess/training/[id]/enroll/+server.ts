import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { findProgramById, enrollSelf } from '$lib/server/ess/training';
import { guardRndEnroll } from '$lib/server/ess/rndJalurGate';

// POST (body opsional { alasan }): daftar mandiri. Program Track R&D melewati gate G_TRN_RND_JALUR (prasyarat jalur sertifikasi);
// mode shadow/warn/soft/hard diatur Superadmin di /settings/gates. `alasan` hanya dipakai pada mode soft.
export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const programId = Number(event.params.id);
	if (!Number.isFinite(programId)) throw error(400, 'ID kursus tidak valid.');

	const program = await findProgramById(programId);
	if (!program || program.status !== 'published') throw error(404, 'Kursus tidak ditemukan.');

	const body = await event.request.json().catch(() => null);
	const alasan = typeof body?.alasan === 'string' ? body.alasan : '';

	let peringatan: string | undefined;
	try {
		({ peringatan } = await guardRndEnroll(karyawan, program, alasan));
	} catch (e: any) {
		throw error(e?.status || 409, e?.message || 'Prasyarat jalur belum tercapai.');
	}

	try {
		const enrollment = await enrollSelf(karyawan.id, program);
		return json({ enrollment, ...(peringatan ? { peringatan } : {}) });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal mendaftar kursus.');
	}
};
