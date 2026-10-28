// src/routes/api/project-finance-pct/[id]/items/+server.ts
// Fase 3b — proxy ke admin erp-epi (/api/project/[id]/field-pending-items): DAFTAR NAMA item yang tertahan di pusat
// (nomor/judul dokumen, status, tahap, approver, umur) TANPA nominal rupiah — keputusan Lead 22 Okt 2026. Pemotongan rupiah dilakukan
// di server admin (whitelist); proxy ini hanya meneruskan. Pola sama project-finance-pct: fail-soft, tidak pernah 500.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	const projectId = Number(event.params.id);
	if (!baseUrl) return json({ available: false, reason: 'Daftar item belum dikonfigurasi.' });
	if (!projectId) return json({ available: false, reason: 'Proyek tidak valid.' });

	const force = event.url.searchParams.get('force') === '1' ? '?force=1' : '';
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/project/${projectId}/field-pending-items${force}`, {
			headers: { Authorization: event.request.headers.get('authorization') || '' },
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) return json({ available: false, reason: `Admin membalas ${res.status} — daftar item tidak dapat ditampilkan saat ini.` });
		const body = await res.json();
		if (!body?.success) return json({ available: false, reason: body?.message || 'Daftar item tidak tersedia.' });
		return json({ available: true, data: body.data });
	} catch (e: any) {
		console.warn('[project-finance-pct/items] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi admin saat ini.' });
	}
}
