// src/routes/api/ess/cuti/aturan/+server.ts
// Aturan pengajuan cuti untuk form (tanggal mulai paling cepat, dihitung dengan tanggal WIB server).
// Validasi final tetap di POST /api/ess/cuti (assertTidakDadakan).

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getAturanPengajuanCuti } from '$lib/server/ess/cuti';

export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	return json(await getAturanPengajuanCuti());
};
