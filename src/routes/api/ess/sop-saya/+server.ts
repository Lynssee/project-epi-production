// src/routes/api/ess/sop-saya/+server.ts
// Meneruskan "SOP Saya" (training yang dibutuhkan SOP jabatan + kesiapan per alur) ke admin erp-epi (/api/ess/sop-saya).
// Pola sama gate-kpi-saya: token Firebase diteruskan apa adanya, fail-soft (TIDAK pernah 500) — kegagalan tidak boleh
// merusak halaman Pelatihan/Kinerja.
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) return json({ available: false, reason: 'SOP Saya belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).' });

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/ess/sop-saya`, {
			headers: { Authorization: event.request.headers.get('authorization') || '' },
			signal: AbortSignal.timeout(10000)
		});
		if (!res.ok) return json({ available: false, reason: `Server admin membalas ${res.status}.` });
		return json(await res.json());
	} catch (e: any) {
		console.warn('[sop-saya] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi server saat ini.' });
	}
}
