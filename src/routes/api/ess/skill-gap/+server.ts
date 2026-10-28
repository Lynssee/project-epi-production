import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getSkillGapForKaryawan } from '$lib/server/ess/skillGap';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const gap = await getSkillGapForKaryawan(karyawan.id, karyawan.jabatan_id);
	return json(gap);
};
