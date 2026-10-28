// src/routes/api/procurement-necessity/+server.ts
// Uji Kebutuhan Beli — Fase 4 (5 Sep 2026): proxy READ-ONLY ke admin erp-epi
// (/api/procurement/necessity) supaya (app)/procurement/ajukan bisa menampilkan
// kartu vonis ringkas SEBELUM mengirim PR — sama seperti pola
// /api/pengajuan-anggaran-timeline (R5, kedua repo berbagi Firebase project,
// token ID diteruskan apa adanya). Fail-soft: admin tak terjangkau -> available:false,
// TIDAK PERNAH mengunci pengisian form.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function POST(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) return json({ available: false, reason: 'Uji Kebutuhan Beli belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).' });

	const body = await event.request.json().catch(() => ({}));
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/procurement/necessity`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: authHeader },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) {
			return json({ available: false, reason: `Admin membalas ${res.status} — Uji Kebutuhan Beli tidak dapat ditampilkan saat ini.` });
		}
		const result = await res.json();
		return json({ available: true, ...result });
	} catch (e: any) {
		console.warn('[procurement-necessity] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi admin saat ini.' });
	}
}
