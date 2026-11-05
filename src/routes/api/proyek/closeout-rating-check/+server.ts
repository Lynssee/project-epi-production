// src/routes/api/proyek/closeout-rating-check/+server.ts
// Meneruskan pemeriksaan gate G_MANPOWER_RATING_CLOSEOUT ke admin erp-epi (/api/kpi/gate-check). Pola sama gate-kpi-saya: token Firebase
// diteruskan apa adanya, fail-soft (TIDAK pernah 500) — kegagalan tidak boleh merusak halaman closeout.
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const projectId = Number(event.url.searchParams.get('projectId'));
	if (!Number.isInteger(projectId) || projectId <= 0) return json({ available: false, reason: 'projectId tidak valid.' });

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) return json({ available: false, reason: 'Pemeriksaan penilaian belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).' });

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/kpi/gate-check`, {
			method: 'POST',
			headers: { Authorization: event.request.headers.get('authorization') || '', 'Content-Type': 'application/json' },
			body: JSON.stringify({ gate: 'G_MANPOWER_RATING_CLOSEOUT', projectId }),
			signal: AbortSignal.timeout(10000)
		});
		if (!res.ok) return json({ available: false, reason: `Server admin membalas ${res.status}.` });
		const g = await res.json();
		return json({ available: g.status === 'passed' || g.status === 'failed', status: g.status, mode: g.mode, blocked: !!g.blocked, detail: g.detail ?? null });
	} catch (e: any) {
		console.warn('[closeout-rating-check] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi server saat ini.' });
	}
}
