// src/routes/api/ess/tim-proyek-tren/+server.ts
// Meneruskan mini-matriks tim proyek (Project Leader) ke admin erp-epi (/api/kpi/tim-proyek-tren). Anggota tim ditentukan
// server admin dari token. Fail-soft (TIDAK pernah 500).
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) return json({ available: false, reason: 'Matriks tim belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).' });

	const params = new URLSearchParams();
	for (const k of ['cadence', 'year', 'month']) {
		const v = event.url.searchParams.get(k);
		if (v) params.set(k, v);
	}
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/kpi/tim-proyek-tren?${params}`, {
			headers: { Authorization: event.request.headers.get('authorization') || '' },
			signal: AbortSignal.timeout(12000)
		});
		if (!res.ok) return json({ available: false, reason: `Server admin membalas ${res.status}.` });
		return json(await res.json());
	} catch (e: any) {
		console.warn('[tim-proyek-tren] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi server saat ini.' });
	}
}
