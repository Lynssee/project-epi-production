import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listMenteesForMentor } from '$lib/server/ess/mentor';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const mentees = await listMenteesForMentor(karyawan.id);
	return json({ mentees });
};
