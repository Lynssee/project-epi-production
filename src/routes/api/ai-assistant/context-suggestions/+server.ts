// src/routes/api/ai-assistant/context-suggestions/+server.ts
// Endpoint privat, BACA SAJA: chip saran pertanyaan per halaman untuk AsistenSheet.svelte.
// Dikelola dari panel admin (/settings/ai-context-templates di erp-epi-1) — lapangan
// tidak punya CRUD sendiri, sama pola dengan ai_glossary. Fase 6, implementation_plan_Modul Asisten AI v3.1.md.

import { json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getSuggestionsForPage } from '$lib/server/aiContextTemplates';

export async function GET(event: RequestEvent) {
	await requireUser(event);
	const page = event.url.searchParams.get('page') || '';
	const suggestions = await getSuggestionsForPage(page, 'field');
	return json({ success: true, data: suggestions });
}
