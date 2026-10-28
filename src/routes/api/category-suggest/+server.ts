// src/routes/api/category-suggest/+server.ts
// PRJ-23 — proxy ke admin erp-epi-1 (/api/pengajuan/category-suggest): saran kategori item PA dari uraian.
// Pola sama dgn project-finance-pct: fail-soft, tidak pernah 500, tidak pernah menahan pengaju mengetik.
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	const text = (event.url.searchParams.get('text') || '').slice(0, 300);
	const chosen = event.url.searchParams.get('chosen') || '';
	if (!baseUrl || text.trim().length < 3) return json({ suggestion: null, mismatch: false });

	const authHeader = event.request.headers.get('authorization') || '';
	try {
		const qs = new URLSearchParams({ text, ...(chosen ? { chosen } : {}) });
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/pengajuan/category-suggest?${qs}`, {
			headers: { Authorization: authHeader },
			signal: AbortSignal.timeout(4000)
		});
		if (!res.ok) return json({ suggestion: null, mismatch: false });
		return json(await res.json());
	} catch (e: any) {
		console.warn('[category-suggest] gagal menghubungi admin (saran dilewati):', e?.message);
		return json({ suggestion: null, mismatch: false });
	}
}
