import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getMyRndJalur } from '$lib/server/ess/rndJalur';

// GET → jalur karier sertifikasi R&D milik karyawan login (level tercapai, progres program Track). Hanya baca.
export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	return json(await getMyRndJalur(karyawan.id));
};
