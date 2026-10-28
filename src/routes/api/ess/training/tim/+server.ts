import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getTeamSilabusProgress } from '$lib/server/ess/silabus';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const anggota = await getTeamSilabusProgress(karyawan.id);
	return json({ anggota });
};
