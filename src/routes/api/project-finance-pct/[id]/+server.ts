// src/routes/api/project-finance-pct/[id]/+server.ts
// UPFE Fase 3 — proxy ke admin erp-epi-1 (/api/project/[id]/field-budget): status pagu RAP proyek dalam PERSEN saja
// (tanpa nominal rupiah — keputusan Lead: Project Leader hanya melihat %; pemotongan dilakukan di server admin).
// Pola sama project-pagu-sisa: fail-soft, tidak pernah 500, kredensial Directus tetap di admin.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	const projectId = Number(event.params.id);
	if (!baseUrl) return json({ available: false, reason: 'Status pagu belum dikonfigurasi.' });
	if (!projectId) return json({ available: false, reason: 'Proyek tidak valid.' });

	const qs = new URLSearchParams();
	if (event.url.searchParams.get('force') === '1') qs.set('force', '1');
	const amount = Number(event.url.searchParams.get('amount'));
	if (Number.isFinite(amount) && amount > 0) qs.set('amount', String(Math.round(amount)));
	const force = qs.toString() ? `?${qs}` : '';
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/project/${projectId}/field-budget${force}`, {
			headers: { Authorization: event.request.headers.get('authorization') || '' },
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) return json({ available: false, reason: `Admin membalas ${res.status} — status pagu tidak dapat ditampilkan saat ini.` });
		const body = await res.json();
		if (!body?.success) return json({ available: false, reason: body?.message || 'Status pagu tidak tersedia.' });
		return json({ available: true, data: body.data });
	} catch (e: any) {
		console.warn('[project-finance-pct] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi admin saat ini.' });
	}
}
