// src/routes/api/project-finance-pct/[id]/ping/+server.ts
// Proxy ke admin erp-epi (/api/project/[id]/field-ping-approver): Project Leader mengingatkan APPROVER yang sedang giliran atas satu PA
// proyek yang tertahan. Cooldown, validasi PA (milik proyek, Pending), dan pengiriman in-app dilakukan di server admin; proxy hanya meneruskan.
// Pola sama project-finance-pct: fail-soft, tidak pernah 500 (kegagalan jadi { available:false, reason }).

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function POST(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	const projectId = Number(event.params.id);
	if (!baseUrl) return json({ available: false, reason: 'Pengingat belum dikonfigurasi.' });
	if (!projectId) return json({ available: false, reason: 'Proyek tidak valid.' });

	const body = await event.request.json().catch(() => null);
	const paId = Number(body?.pa_id);
	if (!Number.isSafeInteger(paId) || paId <= 0) return json({ available: false, reason: 'Pengajuan tidak valid.' });

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/project/${projectId}/field-ping-approver`, {
			method: 'POST',
			headers: { Authorization: event.request.headers.get('authorization') || '', 'Content-Type': 'application/json' },
			body: JSON.stringify({ pa_id: paId }),
			signal: AbortSignal.timeout(10000)
		});
		if (res.status === 403) return json({ available: false, reason: 'Anda tidak terdaftar sebagai Leader/koordinator proyek ini.' });
		if (!res.ok) return json({ available: false, reason: `Admin membalas ${res.status} — pengingat tidak dapat dikirim saat ini.` });
		const out = await res.json();
		if (!out?.success) return json({ available: false, reason: out?.message || 'Pengingat tidak tersedia.' });
		return json({ available: true, data: out.data });
	} catch (e: any) {
		console.warn('[project-finance-pct/ping] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi admin saat ini.' });
	}
}
