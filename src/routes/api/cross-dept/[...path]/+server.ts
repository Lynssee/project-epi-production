// src/routes/api/cross-dept/[...path]/+server.ts
// Proxy sisi server untuk endpoint cross-dept (cuaca-lokasi, pl-tracking, rantai-bahan-spk, ws-timeline-status).
// Mencegah client-side browser memanggil langsung ke origin eksternal dan melanggar CSP connect-src.
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	try {
		await requireUser(event);
	} catch {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const path = event.params.path || '';
	const search = event.url.search || '';
	const baseUrl = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/cross-dept/${path}${search}`, {
			headers: {
				Authorization: authHeader,
				Accept: 'application/json'
			},
			signal: AbortSignal.timeout(10000)
		});

		if (!res.ok) {
			console.warn(`[cross-dept proxy] Upstream returned status ${res.status} for ${path}`);
			return json({ data: null, error: `Upstream error ${res.status}` }, { status: res.status });
		}

		const data = await res.json();
		return json(data);
	} catch (err: any) {
		console.warn(`[cross-dept proxy] Failed to reach upstream for ${path}:`, err?.message || err);
		// Fail-open: kembalikan data null agar UI client tidak crash
		return json({ data: null, error: 'Upstream service unavailable' });
	}
}
