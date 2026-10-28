// src/routes/api/print/product-label/+server.ts
// Proxy server-side untuk generate label produk siap cetak.
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
		const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/print/product-label${search}`, {
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
		const err = await res.json().catch(() => ({}));
		return json({ message: err?.message || `Upstream error ${res.status}` }, { status: res.status });
	} catch (err: any) {
		console.warn('[product-label proxy] Upstream unreachable:', err?.message || err);
		return json({ message: 'Server label admin tidak dapat dihubungi.' }, { status: 503 });
	}
}
