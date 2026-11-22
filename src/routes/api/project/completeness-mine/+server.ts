// src/routes/api/project/completeness-mine/+server.ts
// Proxy server-side Kelengkapan Proyek milik user (erp-epi /api/project/completeness?scope=mine). Pola sama proxy health-mine:
// gagal = 502 jelas (bukan data kosong yang menyesatkan Leader seolah semua lengkap). Parameter dari klien DIBATASI (hanya status/fresh);
// scope=mine (atau ranking bila view=ranking) dipaksa di sini — leader diambil dari token di ERP, bukan dari parameter.
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
	const ranking = event.url.searchParams.get('view') === 'ranking';
	const qs = new URLSearchParams({ scope: ranking ? 'ranking' : 'mine' });
	const status = event.url.searchParams.get('status');
	if (status && !ranking) qs.set('status', status);
	if (event.url.searchParams.get('fresh') === '1') qs.set('fresh', '1');
	try {
		const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/project/completeness?${qs.toString()}`, {
			headers: { Authorization: event.request.headers.get('authorization') || '', Accept: 'application/json' },
			signal: AbortSignal.timeout(15000)
		});
		if (res.ok) return json(await res.json());
		console.warn(`[completeness-mine proxy] Upstream status ${res.status}`);
		return json({ error: `Server kelengkapan menjawab ${res.status}` }, { status: 502 });
	} catch (err: any) {
		console.warn('[completeness-mine proxy] Upstream unreachable:', err?.message || err);
		return json({ error: 'Server kelengkapan tidak terjangkau' }, { status: 502 });
	}
}
