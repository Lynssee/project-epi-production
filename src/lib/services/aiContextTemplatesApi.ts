// src/lib/services/aiContextTemplatesApi.ts
// Client-side wrapper BACA-SAJA untuk chip saran pertanyaan Asisten AI per halaman
// (src/routes/api/ai-assistant/context-suggestions/+server.ts). Dikelola dari
// panel admin (erp-epi-1) — lapangan tidak punya CRUD sendiri. Fase 6, implementation_plan_Modul Asisten AI v3.1.md.

import { auth } from '$lib/firebase';

export async function fetchSuggestionsForPage(pagePath: string): Promise<string[]> {
	try {
		const user = auth?.currentUser;
		if (!user) return [];
		const token = await user.getIdToken();
		const res = await fetch(`/api/ai-assistant/context-suggestions?page=${encodeURIComponent(pagePath)}`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		const data = await res.json().catch(() => null);
		if (!res.ok) return [];
		return Array.isArray(data?.data) ? data.data : [];
	} catch {
		return [];
	}
}
