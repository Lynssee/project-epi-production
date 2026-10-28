import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { reportDiskusi } from '$lib/server/ess/training';

export const POST: RequestHandler = async (event) => {
	await authenticateEss(event);
	const diskusiId = Number(event.params.id);
	if (!Number.isFinite(diskusiId)) throw error(400, 'ID diskusi tidak valid.');

	await reportDiskusi(diskusiId);
	return json({ ok: true });
};
