import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getWall, sendWish, BelongingError } from '$lib/server/ess/belongingServer';

// GET  = Wall of Belonging (milestone rekan di sekitar hari ini).
// POST = ucapan emoji { event_id, emoji } — 1 per karyawan per event; tidak untuk event sendiri.
export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	return json(await getWall(karyawan as any));
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => null);
	if (!body || body.event_id == null) throw error(400, 'event_id wajib diisi.');
	try {
		return json(await sendWish(karyawan as any, { eventId: body.event_id, emoji: String(body.emoji ?? '') }));
	} catch (e) {
		if (e instanceof BelongingError) throw error(e.status, e.message);
		console.error('[api/ess/belonging] POST gagal:', e);
		throw error(500, 'Gagal mengirim ucapan.');
	}
};
