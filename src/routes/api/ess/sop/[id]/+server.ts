import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getSopById, getSopTrainingStatus, hasConfirmedRead, isReadableSop } from '$lib/server/ess/sop';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const sop = await getSopById(Number(event.params.id));
	if (!sop || !isReadableSop(sop)) throw error(404, 'SOP tidak ditemukan.');

	const [sudahKonfirmasi, training] = await Promise.all([
		hasConfirmedRead(sop.id, karyawan.id, sop.version_seq),
		getSopTrainingStatus(sop, karyawan.id)
	]);
	return json({ sop, sudahKonfirmasi, training });
};
