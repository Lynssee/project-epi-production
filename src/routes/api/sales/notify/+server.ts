// src/routes/api/sales/notify/+server.ts
// Fase 2a (Maksimalisasi Notifikasi Sales): relay dari field dashboard ke erp-epi-1
// /api/automation/sales-notify — pola sama persis dengan lemburNotify.ts (AUTOMATION_SERVER_SECRET
// hanya pernah dipegang server, tidak pernah dikirim ke browser). Endpoint ini yang dipanggil
// browser (via fetch same-origin, terautentikasi Firebase), bukan endpoint erp-epi-1 langsung.

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';

export const POST: RequestHandler = async (event) => {
	await authenticateEss(event);

	const body = await event.request.json().catch(() => null);
	const { eventCode, message, karyawanId, sourceCollection, sourceId } = body || {};
	if (!eventCode || !message) throw error(400, 'eventCode dan message wajib diisi.');

	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!baseUrl || !secret) {
		console.warn('[sales/notify] ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi — notifikasi dilewati.');
		return json({ sent: false, reason: 'relay_not_configured' });
	}

	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/sales-notify`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ secret, eventCode, message, karyawanId, sourceCollection, sourceId })
		});
		const data = await res.json().catch(() => null);
		return json(data || { sent: res.ok });
	} catch (e) {
		console.warn('[sales/notify] Gagal memanggil relay erp-epi-1:', e);
		return json({ sent: false, reason: (e as Error).message });
	}
};
