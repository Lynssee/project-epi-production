import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listPublishedSop, fetchComplianceSummary } from '$lib/server/ess/sop';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const sopList = await listPublishedSop();
	const compliance = await fetchComplianceSummary(karyawan.id, sopList);
	return json({ sopList, compliance });
};
