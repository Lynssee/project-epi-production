// src/routes/api/automation/project-action-notify/+server.ts
// Relay dari project-epi ke hub automasi & notifikasi terpusat di erp-epi.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const { eventType, actionItem, projectId, projectName = '', actor = { nama: 'Lapangan' } } = body;

	if (!eventType || !actionItem) {
		return json({ error: 'eventType dan actionItem wajib disertakan' }, { status: 400 });
	}

	const baseUrl = env.ERP_EPI1_BASE_URL || 'https://internal.eltamaprimaindo.com';
	const secret = env.AUTOMATION_SERVER_SECRET || 'd8426c834bf86df6363b655c10b8262dc8bbe5d48b512ced';

	try {
		// Panggil relay di erp-epi
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/project-action-notify`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				secret,
				eventType,
				actionItem,
				projectId,
				projectName,
				actor
			})
		});

		const resJson = await res.json().catch(() => ({}));
		return json({ sent: res.ok, data: resJson });
	} catch (e: any) {
		console.warn('[project-action-notify relay] Gagal relay:', e?.message);
		return json({ sent: false, warning: e?.message });
	}
};
