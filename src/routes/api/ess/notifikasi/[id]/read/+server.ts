import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { markNotificationRead } from '$lib/server/ess/notifikasi';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	try {
		await markNotificationRead(event.params.id!, karyawan.id);
	} catch (e) {
		throw error(403, (e as Error).message);
	}
	return json({ ok: true });
};
