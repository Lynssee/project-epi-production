// src/routes/api/project/exceptions/+server.ts
// Proxy server-side untuk pengecualian proyek (PRJ-31).
// Mencegah client-side browser memanggil langsung ke origin eksternal.
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

	const search = event.url.search || '';
	const baseUrl = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/project/exceptions${search}`, {
			headers: {
				Authorization: authHeader,
				Accept: 'application/json'
			},
			signal: AbortSignal.timeout(10000)
		});

		if (res.ok) {
			const data = await res.json();
			return json(data);
		}
		console.warn(`[project exceptions proxy] Upstream status ${res.status}`);
	} catch (err: any) {
		console.warn('[project exceptions proxy] Upstream unreachable:', err?.message || err);
	}

	// Fail-open fallback: kembalikan struktur kosong agar UI tidak error
	return json({
		data: {
			cards: [],
			totalIssues: 0,
			generatedAt: new Date().toISOString()
		}
	});
}
