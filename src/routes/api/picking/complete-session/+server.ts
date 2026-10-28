// src/routes/api/picking/complete-session/+server.ts
// Fase 3 — Mobile Picking. Tandai sesi picking project ini selesai + simpan 1 foto
// bukti per dokumen (keputusan 4 Agu 2026 — bukan per item).
import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';

export async function POST(event: RequestEvent) {
	const user = await requireUser(event);
	const body = await event.request.json().catch(() => ({}));
	const projectId = Number(body?.projectId);
	const photoFileId = body?.photoFileId ? String(body.photoFileId) : null;
	if (!projectId) throw error(400, 'projectId wajib diisi.');

	await directusServerJson(`/items/projects/${projectId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			last_pick_photo: photoFileId,
			last_pick_completed_at: new Date().toISOString(),
			last_pick_completed_by: user.email
		})
	});

	return json({ ok: true });
}
