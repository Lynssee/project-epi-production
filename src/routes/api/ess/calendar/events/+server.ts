// My Calendar Fase 3 — event custom (personal_events), privat per karyawan.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { createEvent } from '$lib/server/ess/personalEvents';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json();
	const title = String(body.title || '').trim();
	const startDate = String(body.start_date || '').trim();
	if (!title || !startDate) throw error(400, 'Judul dan tanggal mulai wajib diisi.');

	const recurrenceRule = ['daily', 'weekly', 'monthly'].includes(body.recurrence_rule) ? body.recurrence_rule : null;
	if (recurrenceRule && !body.recurrence_until) {
		throw error(400, 'Tanggal "Sampai" wajib diisi untuk event berulang.');
	}

	const record = await createEvent(karyawan.id, {
		title,
		start_date: startDate,
		end_date: body.end_date || null,
		all_day: !!body.all_day,
		color: body.color || null,
		description: body.description || null,
		recurrence_rule: recurrenceRule,
		recurrence_until: recurrenceRule ? body.recurrence_until : null
	});
	return json({ event: record });
};
