// src/routes/api/timeline-adendum/notify-submitted/+server.ts
// Submit adendum timeline dari lapangan (timelineAdendum.ts::createAdendum) masih murni
// client-side via Directus SDK — endpoint tipis ini HANYA memicu relay notifikasi
// (projectNotify.ts) lewat notif-dispatch, menggantikan tulisan langsung ke app_notifications
// yang dulu tidak tercatat di notification_log audit (lihat poin 4 rollout notifikasi Project).
// Fail-soft: dipanggil fire-and-forget dari client setelah adendum berhasil tersimpan.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { notifyProjectAdendumSubmitted } from '$lib/server/projectNotify';

export const POST: RequestHandler = async (event) => {
	await requireUser(event);

	const body = await event.request.json().catch(() => ({}));
	const adendumId = body?.adendumId;
	const projectId = body?.projectId;
	const message = body?.message ? String(body.message) : null;
	if (!adendumId || !projectId || !message) {
		throw error(400, 'adendumId, projectId, dan message wajib diisi.');
	}

	await notifyProjectAdendumSubmitted(adendumId, projectId, message);
	return json({ sent: true });
};
