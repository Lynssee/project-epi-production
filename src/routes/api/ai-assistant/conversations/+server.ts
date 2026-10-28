// src/routes/api/ai-assistant/conversations/+server.ts
// Endpoint privat: daftar thread/percakapan Asisten AI milik user yang login —
// Fase 4, implementation_plan_Modul Asisten AI v3.1.md. Port dari
// erp-epi-1/src/routes/api/it/ai-conversations/+server.js, koleksi Directus SAMA.

import { json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { listThreads } from '$lib/server/aiConversations';

export async function GET(event: RequestEvent) {
	const user = await requireUser(event);
	const threads = await listThreads(user.email);
	return json({ success: true, data: threads });
}
