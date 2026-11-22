// src/routes/api/ess/target-saya/+server.ts
// Meneruskan "Target & Proyeksi Saya" ke admin erp-epi (/api/kpi/target-saya). Token Firebase diteruskan apa adanya;
// identitas ditentukan server admin dari token (bukan query). Fail-soft (TIDAK pernah 500) — tidak boleh merusak halaman Kinerja.
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) return json({ available: false, reason: 'Target & proyeksi belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).' });

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/kpi/target-saya`, {
			headers: { Authorization: event.request.headers.get('authorization') || '' },
			signal: AbortSignal.timeout(12000)
		});
		if (!res.ok) return json({ available: false, reason: `Server admin membalas ${res.status}.` });
		return json(await res.json());
	} catch (e: any) {
		console.warn('[target-saya] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi server saat ini.' });
	}
}
