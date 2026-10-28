// src/routes/api/pengajuan-anggaran-preview/+server.ts
// Lampiran Otomatis v2 (L2) — meneruskan PRATINJAU lampiran pra-submit ke admin
// erp-epi-1 (/api/pengajuan-anggaran/lampiran/preview). Endpoint admin TIDAK diubah;
// pola identik dgn pengajuan-preflight/+server.ts (P4 — satu otoritas generator).
//
// Auth: kedua repo berbagi Firebase project (login-43e72) — token ID diteruskan apa
// adanya. Fail-soft: bila ERP_EPI1_BASE_URL kosong / admin tak terjangkau, balas
// { available:false, reason } — TIDAK pernah 500, TIDAK menahan pengaju.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function POST(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) {
		return json({ available: false, reason: 'Pratinjau lampiran belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).' });
	}

	const body = await event.request.json().catch(() => ({}));
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/pengajuan-anggaran/lampiran/preview`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: authHeader },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(15000)
		});
		if (!res.ok) {
			return json({ available: false, reason: `Server pratinjau membalas ${res.status}.` });
		}
		const result = await res.json();
		return json({ available: true, ...result });
	} catch (e: any) {
		console.warn('[pengajuan-anggaran-preview] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi server pratinjau saat ini.' });
	}
}
