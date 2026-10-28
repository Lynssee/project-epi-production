// src/routes/api/pengajuan-anggaran-tarik/+server.ts
// BIZ-04 — "Tarik Pengajuan" oleh pengaju lapangan. Proxy ke admin erp-epi-1
// (POST /api/pengajuan-anggaran/[id]/cancel): pola SAMA dengan pengajuan-anggaran-ingatkan/timeline — auth diteruskan
// apa adanya (satu Firebase project), TIDAK ada logika bisnis di sini. Guard sesungguhnya (pemilik, belum ada yang
// menyetujui, status, alasan >= 10 karakter) ada di sisi admin (paCancelRules). Soft-cancel: nomor tetap, status 'Dibatalkan'.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

export async function POST(event: RequestEvent) {
	await requireUser(event);

	const body = await event.request.json().catch(() => ({}));
	const pengajuanId = Number(body?.pengajuanId);
	if (!Number.isFinite(pengajuanId) || pengajuanId <= 0) return json({ success: false, message: 'pengajuanId wajib diisi' }, { status: 400 });

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) return json({ success: false, message: 'Fitur ini belum dikonfigurasi (ERP_EPI1_BASE_URL kosong).' }, { status: 503 });

	const authHeader = event.request.headers.get('authorization') || '';
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/pengajuan-anggaran/${pengajuanId}/cancel`, {
			method: 'POST',
			headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
			body: JSON.stringify({ reason: body?.reason }),
			signal: AbortSignal.timeout(20000)
		});
		const result = await res.json().catch(() => ({}));
		return json(result, { status: res.status });
	} catch (e: any) {
		console.warn('[pengajuan-anggaran-tarik] gagal menghubungi admin:', e?.message);
		return json({ success: false, message: 'Tidak dapat menghubungi admin saat ini. Coba lagi.' }, { status: 502 });
	}
}
