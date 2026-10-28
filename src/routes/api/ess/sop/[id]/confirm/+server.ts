import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getSopById, hasConfirmedRead, confirmRead } from '$lib/server/ess/sop';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const sop = await getSopById(Number(event.params.id));
	if (!sop || sop.status !== 'published') throw error(404, 'SOP tidak ditemukan.');

	const sudah = await hasConfirmedRead(sop.id, karyawan.id, sop.version_seq);
	if (!sudah) {
		const ip = event.getClientAddress?.() ?? null;
		await confirmRead(sop.id, karyawan.id, sop.version_seq, ip);
	}
	return json({ ok: true });
};
