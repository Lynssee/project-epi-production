// src/lib/server/kioskAlert.ts
// SERVER-ONLY. Pengiriman alert anomali inventory dari Kiosk ke n8n via webhook.
// Mengikuti aturan proyek: Semua alur automasi wajib menggunakan n8n.

import { env } from '$env/dynamic/private';

export interface KioskAlertPayload {
	type: 'OPNAME_DISCREPANCY' | 'TRANSFER_SHORTAGE';
	title: string;
	detail: Record<string, any>;
}

export async function triggerN8nInventoryAlert(payload: KioskAlertPayload): Promise<void> {
	const webhookUrl = env.N8N_INVENTORY_ALERT_WEBHOOK || env.N8N_WEBHOOK_URL;
	if (!webhookUrl) return;

	try {
		await fetch(webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				source: 'kiosk_inventory',
				timestamp: new Date().toISOString(),
				...payload
			})
		});
	} catch (err) {
		console.warn('[kioskAlert] Gagal memicu webhook n8n (non-fatal):', err);
	}
}
