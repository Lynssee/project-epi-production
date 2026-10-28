import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { markAsRead } from '$lib/server/ess/pengumuman';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	await markAsRead(karyawan.id, event.params.id!);
	return json({ ok: true });
};
