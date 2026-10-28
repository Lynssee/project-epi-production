// src/routes/api/spj-saya/+server.ts
// Fase 5B (Penajaman v2 — Gate & Analisa Pengajuan Anggaran, 2 Sep 2026): "Self-check
// SPJ" — proxy ke admin erp-epi-1 (/api/pengajuan-anggaran/spj-saya). Pola sama persis
// dgn pengajuan-preflight/+server.ts: fail-soft, tidak pernah 500, tidak pernah menahan
// pengaju. Identitas (email) ditentukan admin dari token yang diteruskan, bukan dari
// body/param di sini — proxy ini tidak menyisipkan identitas apa pun.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) {
		return json({ available: false, reason: 'Pemeriksaan SPJ belum dikonfigurasi.' });
	}

	const authHeader = event.request.headers.get('authorization') || '';
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/pengajuan-anggaran/spj-saya`, {
			headers: { Authorization: authHeader },
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) {
			return json({ available: false, reason: `Admin membalas ${res.status} — pengecekan SPJ tidak dapat ditampilkan saat ini.` });
		}
		const result = await res.json();
		return json({ available: true, ...result });
	} catch (e: any) {
		console.warn('[spj-saya] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi admin saat ini.' });
	}
}
