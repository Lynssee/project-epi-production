import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getMyGamifikasiSummary } from '$lib/server/ess/gamifikasi';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const summary = await getMyGamifikasiSummary(karyawan.id);
	return json(summary);
};
