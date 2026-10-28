// src/routes/api/pengajuan-anggaran-ingatkan/+server.ts
// Fase 5 (Rencana KPI Lifecycle v2, L6, 26 Sep 2026): proxy ke admin erp-epi-1
// (/api/pengajuan/approval/[requestId]/ingatkan) — pola SAMA persis dengan
// pengajuan-anggaran-timeline (R5): auth diteruskan apa adanya (kedua repo berbagi
// Firebase project), fail-soft kalau ERP_EPI1_BASE_URL kosong / admin tak terjangkau.
//
// Guard sesungguhnya (pemohon, SLA, rate-limit 1x/24 jam) SEMUA di sisi admin — proxy
// ini TIDAK menduplikasi logika apa pun, sekadar meneruskan.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function POST(event: RequestEvent) {
	await requireUser(event);

	const approvalRequestId = event.url.searchParams.get('approvalRequestId');
	if (!approvalRequestId) return json({ success: false, message: 'approvalRequestId wajib diisi' }, { status: 400 });

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) return json({ success: false, message: 'Fitur ini belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).' });

	const authHeader = event.request.headers.get('authorization') || '';
	try {
		const res = await fetch(
			`${baseUrl.replace(/\/$/, '')}/api/pengajuan/approval/${encodeURIComponent(approvalRequestId)}/ingatkan`,
			{ method: 'POST', headers: { Authorization: authHeader }, signal: AbortSignal.timeout(15000) }
		);
		const result = await res.json().catch(() => ({}));
		return json(result, { status: res.status });
	} catch (e: any) {
		console.warn('[pengajuan-anggaran-ingatkan] gagal menghubungi admin:', e?.message);
		return json({ success: false, message: 'Tidak dapat menghubungi admin saat ini.' });
	}
}
