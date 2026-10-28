import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getSopById, hasConfirmedRead } from '$lib/server/ess/sop';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const sop = await getSopById(Number(event.params.id));
	if (!sop || sop.status !== 'published') throw error(404, 'SOP tidak ditemukan.');

	const sudahKonfirmasi = await hasConfirmedRead(sop.id, karyawan.id, sop.version_seq);
	return json({ sop, sudahKonfirmasi });
};
