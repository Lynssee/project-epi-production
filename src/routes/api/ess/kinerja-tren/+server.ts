// src/routes/api/ess/kinerja-tren/+server.ts
// Meneruskan "Tren Kinerja Saya" ke admin erp-epi (/api/kpi/kinerja-saya-tren). Token Firebase diteruskan apa adanya;
// identitas ditentukan server admin dari token (bukan query). Fail-soft (TIDAK pernah 500) — tidak boleh merusak halaman Kinerja.
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) return json({ available: false, reason: 'Tren kinerja belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).' });

	// Hanya teruskan parameter yang dikenal (cadence, year) — bukan query mentah.
	const params = new URLSearchParams();
	for (const k of ['cadence', 'year']) {
		const v = event.url.searchParams.get(k);
		if (v) params.set(k, v);
	}
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/kpi/kinerja-saya-tren?${params}`, {
			headers: { Authorization: event.request.headers.get('authorization') || '' },
			signal: AbortSignal.timeout(12000)
		});
		if (!res.ok) return json({ available: false, reason: `Server admin membalas ${res.status}.` });
		return json(await res.json());
	} catch (e: any) {
		console.warn('[kinerja-tren] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi server saat ini.' });
	}
}
