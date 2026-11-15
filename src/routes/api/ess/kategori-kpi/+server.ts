// src/routes/api/ess/kategori-kpi/+server.ts
// Meneruskan "Skor Kategori Departemen Saya" ke admin erp-epi (/api/kpi/kategori-saya). Token Firebase diteruskan apa adanya;
// departemen ditentukan server admin dari token (bukan query). Fail-soft (TIDAK pernah 500) — tidak boleh merusak halaman Kinerja.
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) return json({ available: false, reason: 'Skor kategori belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).' });

	// Hanya teruskan parameter yang dikenal (month, YYYY-MM) — bukan query mentah.
	const params = new URLSearchParams();
	const month = event.url.searchParams.get('month');
	if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) params.set('month', month);
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/kpi/kategori-saya?${params}`, {
			headers: { Authorization: event.request.headers.get('authorization') || '' },
			signal: AbortSignal.timeout(15000)
		});
		if (!res.ok) return json({ available: false, reason: `Server admin membalas ${res.status}.` });
		return json(await res.json());
	} catch (e: any) {
		console.warn('[kategori-kpi] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi server saat ini.' });
	}
}
