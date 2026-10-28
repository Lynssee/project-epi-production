// src/routes/api/pengajuan-anggaran-timeline/+server.ts
// R5 (rencana "(joe) Audit & Fix Pengajuan Anggaran" §5.2): "Status pengajuan bisa
// dilihat dari HP". Proxy READ-ONLY ke admin erp-epi-1
// (/api/pengajuan-anggaran/approval-timeline) supaya layar lapangan menampilkan
// RANTAI APPROVAL NYATA (Kadept/GM/Direktur/Finance sesuai nominal) + approver aktif,
// bukan 3 langkah hardcoded yang keliru.
//
// Prasyarat C8 (approver non-Finance masuk timeline) sudah beres di admin.
// Auth: kedua repo berbagi Firebase project — token ID diteruskan apa adanya.
// Fail-soft: bila ERP_EPI1_BASE_URL kosong / admin tak terjangkau → { available:false }.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const pengajuanId = event.url.searchParams.get('pengajuanId');
	if (!pengajuanId) return json({ available: false, reason: 'pengajuanId wajib diisi' });

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) return json({ available: false, reason: 'Status approval belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).' });

	const authHeader = event.request.headers.get('authorization') || '';
	try {
		const res = await fetch(
			`${baseUrl.replace(/\/$/, '')}/api/pengajuan-anggaran/approval-timeline?pengajuanId=${encodeURIComponent(pengajuanId)}`,
			{ headers: { Authorization: authHeader }, signal: AbortSignal.timeout(8000) }
		);
		if (!res.ok) {
			return json({ available: false, reason: `Admin membalas ${res.status} — status approval tidak dapat ditampilkan saat ini.` });
		}
		const result = await res.json();
		return json({ available: true, ...result });
	} catch (e: any) {
		console.warn('[pengajuan-anggaran-timeline] gagal menghubungi admin:', e?.message);
		return json({ available: false, reason: 'Tidak dapat menghubungi admin saat ini.' });
	}
}
