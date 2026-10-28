// src/routes/api/laporan/gate-snapshot/+server.ts
// Meneruskan status Dual Gate PA (G10_HARIAN laporan bolong + G_MOM_BRIEFING) untuk BANYAK proyek
// dalam SATU request ke admin erp-epi (/api/laporan/gate-snapshot). Dipakai badge "Siap Belanja"
// di header. Pola persis readiness-batch: token Firebase diteruskan apa adanya, fail-soft
// (TIDAK pernah 500, TIDAK pernah menahan pengguna).
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function POST(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');

	const body = await event.request.json().catch(() => ({}));
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/laporan/gate-snapshot`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: authHeader },
			body: JSON.stringify({ project_ids: body?.project_ids || [] }),
			signal: AbortSignal.timeout(10000)
		});
		if (!res.ok) return json({ available: false, reason: `Admin membalas ${res.status}.` });
		return json(await res.json());
	} catch (e: any) {
		console.warn('[gate-snapshot] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi pemeriksa gate saat ini.' });
	}
}
