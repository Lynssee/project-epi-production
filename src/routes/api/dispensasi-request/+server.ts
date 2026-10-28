// src/routes/api/dispensasi-request/+server.ts
// Meneruskan permintaan dispensasi gate (G10_HARIAN / G_MOM_BRIEFING) dari lapangan ke admin erp-epi
// (/api/pengajuan/dispensasi/request). Admin yang memegang aturan & otoritas (GM/Direktur memutuskan di
// Kalibrasi Gate PA); repo ini hanya proxy -- token Firebase diteruskan apa adanya (pola pengajuan-preflight).
//   POST { project_id, gate_key, alasan, foto? } -> kirim permintaan
//   GET                                          -> permintaan milik sendiri (?mine=1 di admin)
// Beda dengan preflight: ini aksi tulis yang ditunggu pengguna, jadi pesan validasi admin (400/403/409)
// DITERUSKAN apa adanya; hanya "admin tak terjangkau" yang dijawab 503 dengan pesan jelas.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

async function relay(event: RequestEvent, method: 'GET' | 'POST') {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) {
		return json({ ok: false, message: 'Layanan dispensasi belum dikonfigurasi (ERP_EPI1_BASE_URL kosong). Hubungi admin.' }, { status: 503 });
	}
	const url = `${baseUrl.replace(/\/$/, '')}/api/pengajuan/dispensasi/request${method === 'GET' ? '?mine=1' : ''}`;
	const authHeader = event.request.headers.get('authorization') || '';
	const body = method === 'POST' ? await event.request.json().catch(() => ({})) : null;

	try {
		const res = await fetch(url, {
			method,
			headers: { 'Content-Type': 'application/json', Authorization: authHeader },
			body: body ? JSON.stringify({
				project_id: body.project_id,
				gate_key: body.gate_key,
				alasan: body.alasan,
				foto: body.foto || null
			}) : undefined,
			signal: AbortSignal.timeout(10000)
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) return json({ ok: false, message: data?.message || `Admin membalas ${res.status}.` }, { status: res.status });
		return json({ ok: true, ...data });
	} catch (e: any) {
		console.warn('[dispensasi-request] gagal menghubungi admin:', e?.message);
		return json({ ok: false, message: 'Tidak dapat menghubungi server admin saat ini. Coba lagi sebentar lagi.' }, { status: 503 });
	}
}

export const POST = (event: RequestEvent) => relay(event, 'POST');
export const GET = (event: RequestEvent) => relay(event, 'GET');
