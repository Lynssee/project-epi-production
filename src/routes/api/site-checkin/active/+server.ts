// src/routes/api/site-checkin/active/+server.ts
// GET: check-in aktif milik karyawan yang login (null bila tidak ada).

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getActiveCheckin } from '$lib/server/siteCheckin';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const record = await getActiveCheckin(String(karyawan.id));
	return json({ record });
};
