import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getSisaCutiTahunIni, listCutiByKaryawan } from '$lib/server/ess/cuti';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const [riwayat, sisaCuti] = await Promise.all([
		listCutiByKaryawan(karyawan.id),
		getSisaCutiTahunIni(karyawan.id)
	]);

	return json({ riwayat, sisaCuti });
};
