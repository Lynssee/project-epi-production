// src/lib/server/n8nNotify.ts
// ⚠️ SERVER-ONLY. Trigger notifikasi webhook n8n untuk event lapangan (Fase 4).
// Pola: URL diambil dari env BACKCHARGE_N8N_WEBHOOK_URL dengan fallback ke Directus app_settings.
// Fail-soft: kegagalan pengiriman tidak menggagalkan penyimpanan tiket lapangan.

import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';

let _cachedWebhookUrl: string | null = null;
let _cachedUrlTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 menit

async function getWebhookUrl(): Promise<string | null> {
	if (env.BACKCHARGE_N8N_WEBHOOK_URL) {
		return env.BACKCHARGE_N8N_WEBHOOK_URL;
	}

	const now = Date.now();
	if (_cachedWebhookUrl !== null && now - _cachedUrlTime < CACHE_TTL_MS) {
		return _cachedWebhookUrl;
	}

	try {
		const res = await directusServerJson<{ data?: Array<{ setting_value?: string }> }>(
			'/items/app_settings?filter[module][_eq]=project&filter[setting_key][_eq]=backcharge_n8n_webhook_url&fields=setting_value&limit=1'
		).catch(() => null);

		const val = res?.data?.[0]?.setting_value;
		_cachedWebhookUrl = val ? String(val).trim() : '';
		_cachedUrlTime = now;
		return _cachedWebhookUrl || null;
	} catch {
		return null;
	}
}

/**
 * Kirim event ke n8n webhook
 */
export async function notifyN8n(eventType: string, payload: Record<string, unknown> = {}): Promise<{ sent: boolean; reason?: string }> {
	const webhookUrl = await getWebhookUrl();
	if (!webhookUrl) {
		return { sent: false, reason: 'webhook_not_configured' };
	}

	const body = {
		event: eventType,
		...payload,
		source: 'project-epi',
		triggered_at: new Date().toISOString()
	};

	try {
		const res = await fetch(webhookUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Automated-By': 'project-epi-backcharge'
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(5000)
		});

		return { sent: res.ok };
	} catch (err: any) {
		console.warn('[n8nNotify] Gagal mengirim webhook n8n (diabaikan):', err?.message || err);
		return { sent: false, reason: 'fetch_failed' };
	}
}
