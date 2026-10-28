import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listLemburByKaryawan } from '$lib/server/ess/lembur';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const riwayat = await listLemburByKaryawan(karyawan.id);
	return json({ riwayat });
};
