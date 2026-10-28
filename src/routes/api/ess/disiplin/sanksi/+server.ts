import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listMySanksi } from '$lib/server/ess/disiplinSanksi';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const sanksi = await listMySanksi(karyawan.id);
	return json({ sanksi });
};
