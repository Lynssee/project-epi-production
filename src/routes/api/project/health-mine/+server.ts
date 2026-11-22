// src/routes/api/project/health-mine/+server.ts
// Proxy server-side Health Score proyek milik user (erp-epi /api/project/health-mine). Pola sama proxy exceptions,
// TETAPI gagal = 502 jelas (bukan data kosong): kartu KPI kosong akan menyesatkan Leader seolah semua baik-baik saja.
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
	const baseUrl = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');
	try {
		const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/project/health-mine${event.url.search || ''}`, {
			headers: { Authorization: event.request.headers.get('authorization') || '', Accept: 'application/json' },
			signal: AbortSignal.timeout(15000)
		});
		if (res.ok) return json(await res.json());
		console.warn(`[health-mine proxy] Upstream status ${res.status}`);
		return json({ error: `Server KPI menjawab ${res.status}` }, { status: 502 });
	} catch (err: any) {
		console.warn('[health-mine proxy] Upstream unreachable:', err?.message || err);
		return json({ error: 'Server KPI tidak terjangkau' }, { status: 502 });
	}
}
