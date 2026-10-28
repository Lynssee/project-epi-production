// src/lib/server/salesNotifyRelay.ts
// Relay server-ke-server ke erp-epi-1 /api/automation/sales-notify (pola sama projectNotify.ts/
// fleetNotify.ts) — dipakai dari endpoint maupun cron yang TIDAK punya sesi browser untuk lewat
// /api/sales/notify (yang mewajibkan authenticateEss). Fail-soft mutlak: tidak pernah melempar,
// kegagalan kirim tidak boleh menggagalkan alur bisnis (submit/auto-close).

import { env } from '$env/dynamic/private';

export async function notifySalesServer(
	eventCode: string,
	message: string,
	opts: { karyawanId?: number | string; sourceCollection?: string; sourceId?: number | string; actionUrl?: string } = {}
): Promise<void> {
	try {
		const baseUrl = env.ERP_EPI1_BASE_URL;
		const secret = env.AUTOMATION_SERVER_SECRET;
		if (!baseUrl || !secret) return;
		await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/sales-notify`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ secret, eventCode, message, ...opts })
		});
	} catch (e) {
		console.warn('[salesNotifyRelay] gagal kirim notifikasi (diabaikan):', e);
	}
}
