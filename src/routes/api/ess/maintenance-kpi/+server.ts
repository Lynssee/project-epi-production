import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getMyMaintenanceKpi } from '$lib/server/ess/maintenanceKpi';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const summary = await getMyMaintenanceKpi(karyawan.id);
	return json(summary);
};
