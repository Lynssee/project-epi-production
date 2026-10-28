// src/routes/api/automation/grand-po-dossier-snapshot/+server.ts
// Proxy relay dari dashboard lapangan (project-epi) ke ERP Admin (erp-epi)
// untuk memicu automasi n8n WhatsApp Snapshot Dossier.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const grandPoId = body?.grandPoId || (body?.projectId ? `p${body.projectId}` : null);

	if (!grandPoId) {
		throw error(400, 'grandPoId atau projectId wajib disertakan');
	}

	const baseUrl = env.ERP_EPI1_BASE_URL || 'http://localhost:9391';

	try {
		const targetUrl = `${baseUrl.replace(/\/$/, '')}/api/automation/grand-po-dossier-snapshot`;
		const res = await fetch(targetUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				grandPoId,
				stakeholder: body?.stakeholder || 'operasional',
				annexPreset: body?.annexPreset || 'detailed',
				reportId: body?.reportId || null
			})
		});

		const resJson = await res.json().catch(() => ({}));
		return json(resJson, { status: res.status });
	} catch (e: any) {
		console.warn('[grand-po-dossier-snapshot relay] Gagal memanggil endpoint ERP Admin:', e);
		return json(
			{
				success: false,
				message: `Gagal menghubungi server ERP Admin: ${e?.message || 'Koneksi terputus'}`
			},
			{ status: 502 }
		);
	}
};
