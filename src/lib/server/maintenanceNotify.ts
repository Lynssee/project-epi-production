// src/lib/server/maintenanceNotify.ts
// Rollout notifikasi Maintenance (14 Agu 2026, irisan tersempit) — relay tiket kerusakan
// baru dari lapangan (maint_tickets, createFieldTicket()) ke hub terpusat erp-epi-1.
// GAP yang ditutup: sebelumnya SAMA SEKALI TIDAK ADA notifikasi untuk tiket baru.
// department-level broadcast (bukan personal) karena `pelapor` masih teks bebas.

import { env } from '$env/dynamic/private';

export async function notifyMaintenanceTicketSubmitted(sourceId: number | string, message: string): Promise<void> {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!baseUrl || !secret) {
		console.warn('[maintenanceNotify] ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi — notifikasi dilewati.');
		return;
	}
	try {
		await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/notif-dispatch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				secret,
				eventType: 'maintenance_ticket_submitted',
				message,
				sourceCollection: 'maint_tickets',
				sourceId: String(sourceId),
				actionUrl: '/maintenance',
				actionRequired: true,
				department: 'maintenance'
			})
		});
	} catch (e) {
		console.warn('[maintenanceNotify] Gagal memanggil relay notif-dispatch erp-epi-1:', e);
	}
}
