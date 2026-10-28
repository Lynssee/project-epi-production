import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listMySkills } from '$lib/server/ess/trainingSkill';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const skills = await listMySkills(karyawan.id);
	return json({ skills });
};
