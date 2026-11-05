// src/routes/api/ess/tim-proyek-saya/+server.ts
// Meneruskan "Performa Tim Proyek Saya" ke admin erp-epi (/api/kpi/tim-proyek-saya). Pola sama gate-kpi-saya: token Firebase
// diteruskan apa adanya, fail-soft (TIDAK pernah 500) — kegagalan tidak boleh merusak halaman Kinerja.
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) return json({ available: false, reason: 'Performa tim belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).' });

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/kpi/tim-proyek-saya`, {
			headers: { Authorization: event.request.headers.get('authorization') || '' },
			signal: AbortSignal.timeout(10000)
		});
		if (!res.ok) return json({ available: false, reason: `Server admin membalas ${res.status}.` });
		return json(await res.json());
	} catch (e: any) {
		console.warn('[tim-proyek-saya] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi server saat ini.' });
	}
}
