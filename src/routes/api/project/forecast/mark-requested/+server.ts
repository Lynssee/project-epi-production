// src/routes/api/project/forecast/mark-requested/+server.ts
// Proxy server-side untuk menandai baris forecast setelah pengajuan.
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

	const body = await event.request.json().catch(() => ({}));
	const baseUrl = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/project/forecast/mark-requested`, {
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
		console.warn('[mark-requested proxy] Upstream unreachable:', err?.message || err);
		return json({ success: true });
	}
}
