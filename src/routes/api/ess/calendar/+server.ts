// My Calendar Fase 3 — aggregator, dibatasi rentang ?from=YYYY-MM-DD&to=YYYY-MM-DD.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listCalendarEvents } from '$lib/server/ess/calendar';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const from = event.url.searchParams.get('from') || '';
	const to = event.url.searchParams.get('to') || '';
	if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw error(400, 'Parameter from/to wajib format YYYY-MM-DD.');

	const events = await listCalendarEvents(karyawan.id, from, to);
	return json({ events });
};
