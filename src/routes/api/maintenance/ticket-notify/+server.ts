// src/routes/api/maintenance/ticket-notify/+server.ts
// createFieldTicket() (maintenance.ts) masih murni client-side via Directus SDK — endpoint
// tipis ini HANYA memicu relay notifikasi (maintenanceNotify.ts), fire-and-forget dari
// client setelah tiket berhasil tersimpan.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { notifyMaintenanceTicketSubmitted } from '$lib/server/maintenanceNotify';

export const POST: RequestHandler = async (event) => {
	await requireUser(event);

	const body = await event.request.json().catch(() => ({}));
	const sourceId = body?.sourceId;
	const message = body?.message ? String(body.message) : null;
	if (!sourceId || !message) throw error(400, 'sourceId dan message wajib diisi.');

	await notifyMaintenanceTicketSubmitted(sourceId, message);
	return json({ sent: true });
};
