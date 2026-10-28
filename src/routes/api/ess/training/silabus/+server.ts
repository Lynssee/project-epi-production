import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getSilabusProgressForKaryawan } from '$lib/server/ess/silabus';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const result = await getSilabusProgressForKaryawan(karyawan);
	return json(result);
};
