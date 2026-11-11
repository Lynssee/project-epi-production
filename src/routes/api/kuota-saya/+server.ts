// src/routes/api/kuota-saya/+server.ts
// Self-check kuota pengajuan yang masih menunggu keputusan (gate G_PA_INFLIGHT_CAP) — proxy ke admin
// erp-epi (/api/pengajuan-anggaran/kuota-saya). Pola sama persis dgn spj-saya/+server.ts: fail-soft,
// tidak pernah 500, tidak pernah menahan pengaju. Identitas (email) ditentukan admin dari token yang
// diteruskan, bukan dari body/param di sini.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) {
		return json({ available: false, reason: 'Pemeriksaan kuota belum dikonfigurasi.' });
	}

	const authHeader = event.request.headers.get('authorization') || '';
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/pengajuan-anggaran/kuota-saya`, {
			headers: { Authorization: authHeader },
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) {
			return json({ available: false, reason: `Admin membalas ${res.status} — pengecekan kuota tidak dapat ditampilkan saat ini.` });
		}
		const result = await res.json();
		return json({ available: true, ...result });
	} catch (e: any) {
		console.warn('[kuota-saya] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi admin saat ini.' });
	}
}
