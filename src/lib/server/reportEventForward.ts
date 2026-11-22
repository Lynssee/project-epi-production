// src/lib/server/reportEventForward.ts
// SERVER-ONLY. Report Center — teruskan event unduhan/cetak dari endpoint export lapangan ke admin erp-epi
// (/api/reports/event) agar satu log untuk dua aplikasi. Fire-and-forget: TIDAK PERNAH melempar dan TIDAK menunggu,
// jadi gangguan admin tidak menunda/membatalkan unduhan. Identitas ditentukan admin dari token yang diteruskan.

import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export function forwardReportEvent(
	event: RequestEvent,
	evt: { catalog_key: string; format?: string; action?: string; entity_collection?: string; entity_id?: string | number | null; row_count?: number }
): void {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const auth = event.request.headers.get('authorization');
	if (!baseUrl || !auth) return;
	void fetch(`${baseUrl.replace(/\/$/, '')}/api/reports/event`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: auth },
		body: JSON.stringify({ action: 'download', ...evt, entity_id: evt.entity_id == null ? undefined : String(evt.entity_id), app: 'lapangan' }),
		signal: AbortSignal.timeout(5000)
	}).catch((e: any) => console.warn('[reportEventForward] tidak tercatat (non-fatal):', e?.message));
}
