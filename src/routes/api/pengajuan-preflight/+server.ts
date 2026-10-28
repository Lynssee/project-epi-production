// src/routes/api/pengajuan-preflight/+server.ts
// Fase 3 (AI Analysis Engine Modul Pengajuan v2.0, Bab 9.1) — meneruskan cek gate
// pra-terbang ke admin erp-epi-1 (/api/pengajuan/validate, mode pre-flight tanpa
// pengajuan_id). Endpoint admin itu TIDAK diubah sama sekali (P4 — satu otoritas
// per keputusan).
//
// Auth: kedua repo berbagi Firebase project yang sama (VITE_FIREBASE_PROJECT_ID
// login-43e72 di kedua .env) — Google Identity Toolkit tidak mengecek origin/audience
// selain project, jadi token ID Firebase milik pemanggil diteruskan apa adanya, tanpa
// mekanisme auth baru.
//
// Fail-soft (pola sama seperti lemburNotify.ts::relayWaNotify): bila ERP_EPI1_BASE_URL
// belum diisi, atau admin tidak terjangkau, balas {available:false, reason} — TIDAK
// pernah 500, TIDAK pernah menahan pengaju mengirim pengajuan.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function POST(event: RequestEvent) {
	await requireUser(event); // verifikasi lokal dulu sebelum diteruskan ke admin

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) {
		return json({ available: false, reason: 'Pemeriksaan gate belum dikonfigurasi (ERP_EPI1_BASE_URL kosong) — pengajuan tetap bisa dikirim.' });
	}

	const body = await event.request.json().catch(() => ({}));
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/pengajuan/validate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: authHeader },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(10000)
		});
		if (!res.ok) {
			return json({ available: false, reason: `Pemeriksa gate admin membalas ${res.status} — pengajuan tetap bisa dikirim.` });
		}
		const result = await res.json();
		return json({ available: true, ...result });
	} catch (e: any) {
		console.warn('[pengajuan-preflight] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi pemeriksa gate saat ini — pengajuan tetap bisa dikirim.' });
	}
}
