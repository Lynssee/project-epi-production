import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getMyActiveOffboardingCase, listClearanceForCase } from '$lib/server/ess/offboarding';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const kasus = await getMyActiveOffboardingCase(karyawan.id);
	if (!kasus) return json({ kasus: null, clearance: [] });

	const clearance = await listClearanceForCase(kasus.id);
	return json({ kasus, clearance });
};
