// src/routes/api/project/[id]/print-url/+server.ts
// UPFE Fase 4 — Penyedia URL Cetak Dokumen Proyek Lintas Stakeholder (Admin erp-epi).
// Menerapkan pembatasan persona lapangan: hanya stakeholder 'operasional' dan 'customer' yang diperbolehkan.
// Stakeholder internal ('finance', 'management') ditolak demi keamanan data HPP internal.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	const projectId = Number(event.params.id);
	if (!baseUrl) return json({ available: false, reason: 'Koneksi ke sistem ERP Admin belum dikonfigurasi.' });
	if (!projectId) return json({ available: false, reason: 'ID Proyek tidak valid.' });

	const stakeholder = event.url.searchParams.get('stakeholder') || 'operasional';
	const depth = event.url.searchParams.get('depth') || 'summary';
	const customerMoney = event.url.searchParams.get('customerMoney') || 'technical';
	const report = event.url.searchParams.get('report') || '';

	// Proteksi ketat: Dashboard lapangan DILARANG membuka dossier persona finance / management internal
	if (stakeholder !== 'operasional' && stakeholder !== 'customer') {
		return json({
			available: false,
			reason: 'Hak akses terbatas: dashboard lapangan hanya dapat mengakses persona Operasional dan Customer.'
		}, { status: 403 });
	}

	const cleanBase = baseUrl.replace(/\/$/, '');
	// Format paket virtual 1 PO proyek adalah "p<projectId>" di /print/grand-po/
	let printUrl = `${cleanBase}/print/grand-po/p${projectId}?stakeholder=${encodeURIComponent(stakeholder)}&depth=${encodeURIComponent(depth)}&customerMoney=${encodeURIComponent(customerMoney)}`;
	if (report) {
		printUrl += `&report=${encodeURIComponent(report)}`;
	}

	return json({
		available: true,
		url: printUrl,
		stakeholder,
		depth
	});
}
