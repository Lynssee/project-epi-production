// src/routes/api/ess/data-lengkap/+server.ts
// Countdown Kelengkapan Data Karyawan Baru — status kelengkapan data diri milik sendiri,
// dipakai popup/banner countdown di dashboard ESS.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getDataLengkapStatus } from '$lib/server/ess/dataKelengkapan';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const status = await getDataLengkapStatus(karyawan.id);
	return json(status);
};
