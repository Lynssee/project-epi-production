// My Calendar Fase 3 — update & delete event custom, ownership-checked.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { updateEvent, deleteEvent } from '$lib/server/ess/personalEvents';

export const PATCH: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const eventId = Number(event.params.id);
	if (!Number.isFinite(eventId)) throw error(400, 'ID event tidak valid.');

	const body = await event.request.json();
	const patch: Record<string, any> = {};
	if (body.title !== undefined) patch.title = String(body.title).trim();
	if (body.start_date !== undefined) patch.start_date = body.start_date;
	if (body.end_date !== undefined) patch.end_date = body.end_date || null;
	if (body.all_day !== undefined) patch.all_day = !!body.all_day;
	if (body.color !== undefined) patch.color = body.color || null;
	if (body.description !== undefined) patch.description = body.description || null;

	try {
		const record = await updateEvent(karyawan.id, eventId, patch);
		return json({ event: record });
	} catch (e: any) {
		throw error(404, e?.message || 'Event tidak ditemukan.');
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const eventId = Number(event.params.id);
	if (!Number.isFinite(eventId)) throw error(400, 'ID event tidak valid.');

	try {
		await deleteEvent(karyawan.id, eventId);
		return json({ ok: true });
	} catch (e: any) {
		throw error(404, e?.message || 'Event tidak ditemukan.');
	}
};
