// src/routes/api/hse/incident-notify/+server.ts
// submitHseIncident() (hse.ts) masih murni client-side via Directus SDK — endpoint tipis
// ini HANYA memicu eskalasi WA (hseNotify.ts) untuk insiden KRITIS, menggantikan tidak
// ada, fire-and-forget dari client setelah insiden berhasil tersimpan.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { notifyHseIncidentCritical } from '$lib/server/hseNotify';

export const POST: RequestHandler = async (event) => {
	await requireUser(event);

	const body = await event.request.json().catch(() => ({}));
	const sourceId = body?.sourceId;
	const message = body?.message ? String(body.message) : null;
	if (!sourceId || !message) throw error(400, 'sourceId dan message wajib diisi.');

	await notifyHseIncidentCritical(sourceId, message);
	return json({ sent: true });
};
