// src/routes/api/laporan/[id]/decide/+server.ts
// Proxy server-side untuk keputusan review laporan (approve / revision_requested).
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function POST(event: RequestEvent) {
	try {
		await requireUser(event);
	} catch {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const id = event.params.id || '';
	const body = await event.request.json().catch(() => ({}));
	const baseUrl = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/laporan/${id}/decide`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: authHeader,
				Accept: 'application/json'
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(10000)
		});

		if (res.ok) {
			const data = await res.json();
			return json(data);
		}
		const err = await res.json().catch(() => ({}));
		return json({ success: false, message: err?.message || `Upstream error ${res.status}` }, { status: res.status });
	} catch (err: any) {
		console.warn(`[laporan decide proxy] Upstream unreachable for ${id}:`, err?.message || err);
		return json({ success: false, message: 'Server admin tidak dapat dihubungi.' }, { status: 503 });
	}
}
