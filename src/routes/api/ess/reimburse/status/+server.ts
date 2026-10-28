import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listReimburseByKaryawan } from '$lib/server/ess/reimburse';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const riwayat = await listReimburseByKaryawan(karyawan.id);
	return json({ riwayat });
};
