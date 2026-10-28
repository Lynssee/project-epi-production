// src/routes/api/plafon-mandiri-status/+server.ts
// Rencana Self-Service PL v2, FASE 2 — meneruskan cek Plafon Mandiri PL ke admin
// erp-epi-1 (/api/plafon-mandiri/status). Endpoint admin TIDAK diubah (satu otoritas).
//
// Auth & fail-soft: pola sama persis dengan pengajuan-preflight/+server.ts — token
// Firebase diteruskan apa adanya; bila admin tak terjangkau balas {available:false}
// dan JANGAN pernah menahan pengaju.
//
// GET ?projectId=&amount=&kategori=

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) {
		return json({ available: false, reason: 'Plafon mandiri belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).' });
	}

	const authHeader = event.request.headers.get('authorization') || '';
	const qs = event.url.searchParams.toString();

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/plafon-mandiri/status?${qs}`, {
			method: 'GET',
			headers: { Authorization: authHeader },
			signal: AbortSignal.timeout(10000)
		});
		if (!res.ok) {
			return json({ available: false, reason: `Admin membalas ${res.status}.` });
		}
		const result = await res.json();
		return json({ available: true, ...result });
	} catch (e: any) {
		console.warn('[plafon-mandiri-status] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi admin saat ini.' });
	}
}
