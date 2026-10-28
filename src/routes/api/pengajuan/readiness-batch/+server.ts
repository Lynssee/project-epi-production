// src/routes/api/pengajuan/readiness-batch/+server.ts
// Meneruskan "Kesiapan Proyek Saya" (G9/G10/G11 banyak proyek, SATU request) ke admin erp-epi-1
// (/api/pengajuan/readiness-batch). Sebelumnya rute ini TIDAK ADA di repo lapangan, sehingga
// halaman /anggaran/cek-gate dan widget Home selalu 404 diam-diam. Pola persis
// pengajuan-preflight: token Firebase diteruskan apa adanya, fail-soft (TIDAK pernah 500).
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function POST(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) {
		return json({ available: false, reason: 'Kesiapan proyek belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).', projects: [] });
	}

	const body = await event.request.json().catch(() => ({}));
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/pengajuan/readiness-batch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: authHeader },
			// include_siap (opt-in, Fase 4b) harus ikut diteruskan -- tanpa ini G_SIAP per proyek tak pernah sampai ke UI.
			body: JSON.stringify({ project_ids: body?.project_ids || [], ...(body?.include_siap === true ? { include_siap: true } : {}) }),
			signal: AbortSignal.timeout(10000)
		});
		if (!res.ok) {
			return json({ available: false, reason: `Pemeriksa kesiapan admin membalas ${res.status}.`, projects: [] });
		}
		return json({ available: true, ...(await res.json()) });
	} catch (e: any) {
		console.warn('[readiness-batch] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi pemeriksa kesiapan saat ini.', projects: [] });
	}
}
