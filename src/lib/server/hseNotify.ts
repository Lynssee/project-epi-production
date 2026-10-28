// src/lib/server/hseNotify.ts
// Rollout notifikasi HSE (14 Agu 2026, irisan tersempit) — relay insiden HSE KRITIS dari
// lapangan ke hub terpusat di erp-epi-1, pola sama persis dgn gaChecklistNotify.ts/
// projectNotify.ts. TIDAK menggantikan notifyHseReport() lama di hse.ts (in-app manual,
// tetap jalan) — murni tambahan eskalasi WA.

import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';

async function fetchHseOfficerRecipients(): Promise<{ nama: string; no_telpon: string }[]> {
	try {
		const res = await directusServerJson<{ data: { nama: string; no_telpon: string }[] }>(
			`/items/hse_notify_recipients?limit=-1&fields=nama,no_telpon&filter[active][_eq]=true&filter[role][_eq]=hse_officer`
		);
		return res?.data || [];
	} catch {
		return [];
	}
}

export async function notifyHseIncidentCritical(sourceId: number | string, message: string): Promise<void> {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!baseUrl || !secret) {
		console.warn('[hseNotify] ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi — notifikasi dilewati.');
		return;
	}
	try {
		const waRecipients = await fetchHseOfficerRecipients();
		await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/notif-dispatch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				secret,
				eventType: 'hse_incident_critical',
				message,
				waRecipients,
				sourceCollection: 'hse_incident',
				sourceId: String(sourceId),
				actionUrl: '/hse?tab=incidents',
				actionRequired: true,
				department: 'hse'
			})
		});
	} catch (e) {
		console.warn('[hseNotify] Gagal memanggil relay notif-dispatch erp-epi-1:', e);
	}
}
