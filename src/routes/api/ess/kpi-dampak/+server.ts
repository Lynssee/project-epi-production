// src/routes/api/ess/kpi-dampak/+server.ts
// Meneruskan "Dampak KPI Saya" ke admin erp-epi (/api/kpi/finance-impact/saya). Token Firebase diteruskan apa adanya;
// departemen ditentukan server admin dari token (bukan query). Admin yang menentukan apa yang boleh tampil (off | arah | rp) —
// koefisien/rumus/basis/budget TIDAK PERNAH dikirim. Fail-soft (TIDAK pernah 500) — tidak boleh merusak dashboard Leader.
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) return json({ available: false, reason: 'Dampak KPI belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).' });

	// Hanya teruskan parameter yang dikenal (month, YYYY-MM) — bukan query mentah.
	const params = new URLSearchParams();
	const month = event.url.searchParams.get('month');
	if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) params.set('month', month);
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/kpi/finance-impact/saya?${params}`, {
			headers: { Authorization: event.request.headers.get('authorization') || '' },
			signal: AbortSignal.timeout(15000)
		});
		if (!res.ok) return json({ available: false, reason: `Server admin membalas ${res.status}.` });
		return json(await res.json());
	} catch (e: any) {
		console.warn('[kpi-dampak] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi server saat ini.' });
	}
}
