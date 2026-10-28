// src/routes/api/ai-assistant/feedback/+server.ts
// Endpoint privat: 👍/👎 per jawaban Asisten AI. chatLogId hanya pernah diketahui
// klien dari respons /api/ai-assistant milik percakapannya sendiri. Port dari erp-epi-1.

import { json, error, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';

export async function POST(event: RequestEvent) {
	const user = await requireUser(event);

	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Body harus JSON');
	}

	const chatLogId = Number(body?.chatLogId);
	const threadId = Number.isFinite(Number(body?.threadId)) ? Number(body.threadId) : null;
	const verdict = body?.verdict === 'up' || body?.verdict === 'down' ? body.verdict : null;
	if (!Number.isFinite(chatLogId)) throw error(400, 'chatLogId wajib diisi');
	if (!verdict) throw error(400, 'verdict wajib "up" atau "down"');

	const created = await directusServerJson('/items/ai_feedback', {
		method: 'POST',
		body: JSON.stringify({
			chat_log_id: chatLogId,
			thread_id: threadId,
			user_email: user.email,
			verdict,
			note: body?.note ? String(body.note).slice(0, 2000) : ''
		})
	});

	return json({ success: true, data: (created as any)?.data || created });
}
