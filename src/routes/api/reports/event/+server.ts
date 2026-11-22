// src/routes/api/reports/event/+server.ts
// Report Center Fase 6 — pencatatan event laporan dari aplikasi LAPANGAN. Proxy ke admin erp-epi
// (/api/reports/event) supaya satu log, satu aturan gate, satu sumber kebenaran. Identitas user ditentukan
// admin dari token yang diteruskan. Fail-soft: TIDAK PERNAH 500 dan tidak pernah menahan unduhan/cetak.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function POST(event: RequestEvent) {
	await requireUser(event);
	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) return json({ logged: false }, { status: 202 });

	let body: Record<string, unknown> = {};
	try {
		body = await event.request.json();
	} catch {
		return json({ logged: false }, { status: 202 });
	}
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/reports/event`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: event.request.headers.get('authorization') || '' },
			body: JSON.stringify({ ...body, app: 'lapangan' }),
			signal: AbortSignal.timeout(6000)
		});
		return json({ logged: res.ok }, { status: res.ok ? 200 : 202 });
	} catch (e: any) {
		console.warn('[reports/event] gagal menghubungi admin:', e?.message);
		return json({ logged: false }, { status: 202 });
	}
}
