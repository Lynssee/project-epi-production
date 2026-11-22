// GET /api/ess/sop/sertifikasi — daftar SOP yang sudah "Tersertifikasi" (training SOP lulus) milik karyawan login.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listSopSertifikasi } from '$lib/server/ess/sop';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	return json({ sertifikasi: await listSopSertifikasi(karyawan.id) });
};
