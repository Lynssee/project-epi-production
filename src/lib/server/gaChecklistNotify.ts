// src/lib/server/gaChecklistNotify.ts
// Notifikasi Terpusat v2 (Fase 2/6, pilot GA): relay Submit checklist GA ke hub terpusat di
// erp-epi-1 (/api/automation/notif-dispatch), pola sama persis dgn sjiNotify.ts/lemburNotify.ts
// — FONNTE_TOKEN & registry event hanya ada di env/kode erp-epi-1.
//
// Menggantikan POST langsung ke app_notifications yang lama di ga-checklist/submit/+server.ts —
// sekarang tercatat juga di notification_log (erp-epi-1) untuk audit lintas-channel.
// Gagal kirim TIDAK BOLEH menggagalkan alur submit checklist — fail-soft (log warning saja).

import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';

async function fetchGaGroupRecipients(): Promise<{ nama: string; no_telpon: string }[]> {
	try {
		const res = await directusServerJson<{ data: { nama: string; no_telpon: string }[] }>(
			`/items/hrd_notify_recipients?limit=-1&fields=nama,no_telpon&filter[active][_eq]=true`
		);
		return res?.data || [];
	} catch {
		return [];
	}
}

async function dispatch(eventType: string, message: string, opts: { waRecipients?: { nama: string; no_telpon: string }[]; sourceId?: string | number; actionUrl?: string }) {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!baseUrl || !secret) {
		console.warn('[gaChecklistNotify] ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi — notifikasi dilewati.');
		return;
	}
	try {
		await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/notif-dispatch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				secret,
				eventType,
				message,
				waRecipients: opts.waRecipients || [],
				sourceCollection: 'ga_checklist_responses',
				sourceId: opts.sourceId != null ? String(opts.sourceId) : undefined,
				actionUrl: opts.actionUrl,
				actionRequired: true,
				department: 'hrd'
			})
		});
	} catch (e) {
		console.warn('[gaChecklistNotify] Gagal memanggil relay notif-dispatch erp-epi-1:', e);
	}
}

/**
 * Notifikasi Submit (Ketukan 1) checklist GA — dipanggil dari ga-checklist/submit/+server.ts
 * setelah response & findings tersimpan.
 */
export async function notifyGaChecklistSubmitted(
	responseId: number | string,
	contextLabel: string,
	scoringResult: number,
	criticalCount: number
): Promise<void> {
	const actionUrl = '/hrd?tab=ga-checklist';
	if (criticalCount > 0) {
		const waRecipients = await fetchGaGroupRecipients();
		await dispatch(
			'ga_checklist_critical_finding',
			`⚠️ Checklist ${contextLabel} memiliki ${criticalCount} temuan kritis yang butuh tindak lanjut segera.`,
			{ waRecipients, sourceId: responseId, actionUrl }
		);
	} else {
		await dispatch('ga_checklist_submitted', `Checklist ${contextLabel} disubmit. Skor: ${scoringResult}%. Menunggu verifikasi supervisor.`, {
			sourceId: responseId,
			actionUrl
		});
	}
}
