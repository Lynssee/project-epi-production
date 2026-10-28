// src/routes/api/maintenance/mark-wo-done/+server.ts
// Pusat Maintenance v2 Fase 6 (14 Sep 2026) — menutup celah write-guard: sebelumnya
// markWorkOrderDone() (maintenance.ts) menulis order_status LANGSUNG ke Directus lewat
// client SDK, sama sekali tidak lewat gate G_WO1-G_WO8 yang ditegakkan di erp-epi-1
// (updateWorkOrder()). Proxy TIPIS ke erp-epi-1 (/api/automation/maintenance-wo-transition),
// pola sama src/lib/server/maintenanceNotify.ts — secret hanya hidup di server, tidak pernah
// dikirim ke browser.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request }) => {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!baseUrl || !secret) {
		throw error(503, 'ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi di server.');
	}

	const body = await request.json().catch(() => null);
	const workOrderId = body?.workOrderId;
	if (!workOrderId) throw error(400, 'workOrderId wajib diisi.');

	const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/maintenance-wo-transition`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			secret,
			workOrderId,
			targetStatusName: 'Inspection',
			extraFields: { progress: 100 }
		})
	});
	const data = await res.json().catch(() => null);
	if (res.status === 409) {
		// Gate G_WO4/G_WO6/G_WO7 menolak — pesan sudah jelas, teruskan apa adanya ke mekanik.
		throw error(409, data?.message || 'WO ini belum memenuhi syarat untuk masuk QC.');
	}
	if (!res.ok) {
		throw error(res.status, data?.message || 'Gagal menandai WO selesai.');
	}
	return json(data?.data || null);
};
