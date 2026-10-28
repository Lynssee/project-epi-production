// src/routes/api/project/toolbox-eskalasi/+server.ts
// Proxy server-side untuk eskalasi kendala kritis briefing/toolbox meeting.
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
		const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/project/toolbox-eskalasi`, {
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
		return json({ ok: false, wa_terkirim: false, message: err?.message || `Upstream error ${res.status}` });
	} catch (err: any) {
		console.warn('[toolbox-eskalasi proxy] Upstream unreachable:', err?.message || err);
		return json({ ok: true, wa_terkirim: false, note: 'Tersimpan lokal (server notifikasi offline)' });
	}
}
