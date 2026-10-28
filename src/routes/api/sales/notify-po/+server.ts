// src/routes/api/sales/notify-po/+server.ts
// Fase 4 (Sales B2B PO/RAP v2) — relay notifikasi "PO diunggah dari lapangan" ke
// admin erp-epi-1 (/api/sales/notify, eventCode=PO_UPLOADED). Sama pola dengan
// rap-seed relay — logika notifikasi HANYA hidup di salesNotify.js (erp-epi-1).
//
// Fail-soft (best-effort, sama seperti pengajuan-preflight): gagal kirim notifikasi
// TIDAK PERNAH menggagalkan upload PO itu sendiri — foto sudah tersimpan, notifikasi
// cuma pemberitahuan tambahan.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function POST(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) return json({ sent: false, reason: 'ERP_EPI1_BASE_URL kosong' });

	const body = await event.request.json().catch(() => ({}));
	const authHeader = event.request.headers.get('authorization') || '';

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/sales/notify`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: authHeader },
			body: JSON.stringify({ eventCode: 'PO_UPLOADED', ...body }),
			signal: AbortSignal.timeout(10000)
		});
		const result = await res.json().catch(() => ({}));
		return json({ sent: res.ok, ...result });
	} catch (e: any) {
		console.warn('[notify-po relay] gagal menghubungi admin:', e?.message);
		return json({ sent: false, reason: 'Tidak dapat menghubungi admin erp-epi-1 saat ini.' });
	}
}
