// src/routes/api/manpower-k3/+server.ts
// Relay tes K3 calon manpower lapangan ke admin erp-epi (/api/hrd/manpower-k3). Admin yang memegang bank soal, penilaian, dan gate;
// repo ini hanya proxy — token Firebase diteruskan apa adanya (pola /api/dispensasi-request).
//   GET  ?ids=1,2,3                 -> status K3 per pekerja
//   POST { manpower_id, kirim_wa? } -> buat/pakai ulang tautan tes (+ WA ke pekerja)
// Pesan validasi admin (400/404/409/422) DITERUSKAN apa adanya agar Project Leader tahu apa yang harus dilakukan;
// hanya "admin tak terjangkau" yang dijawab 503 dengan pesan jelas.
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireUser } from '$lib/server/firebaseAuth';

async function relay(event: RequestEvent, method: 'GET' | 'POST') {
	await requireUser(event);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	if (!baseUrl) {
		return json({ ok: false, message: 'Layanan tes K3 belum dikonfigurasi (ERP_EPI1_BASE_URL kosong). Hubungi admin.' }, { status: 503 });
	}
	const base = `${baseUrl.replace(/\/$/, '')}/api/hrd/manpower-k3`;
	const authHeader = event.request.headers.get('authorization') || '';

	let url = base;
	let body: string | undefined;
	if (method === 'GET') {
		const ids = (event.url.searchParams.get('ids') || '').replace(/[^\d,]/g, '');
		if (!ids) return json({ ok: false, message: 'ids wajib diisi.' }, { status: 400 });
		url = `${base}?ids=${ids}`;
	} else {
		const b = await event.request.json().catch(() => ({}));
		body = JSON.stringify({ manpower_id: Number(b?.manpower_id), kirim_wa: b?.kirim_wa === true });
	}

	try {
		const res = await fetch(url, {
			method,
			headers: { 'Content-Type': 'application/json', Authorization: authHeader },
			body,
			signal: AbortSignal.timeout(15000)
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) return json({ ok: false, message: data?.message || `Admin membalas ${res.status}.` }, { status: res.status });
		return json({ ok: true, ...data });
	} catch (e: any) {
		console.warn('[manpower-k3] gagal menghubungi admin:', e?.message);
		return json({ ok: false, message: 'Tidak dapat menghubungi server admin saat ini. Coba lagi sebentar lagi.' }, { status: 503 });
	}
}

export const GET = (event: RequestEvent) => relay(event, 'GET');
export const POST = (event: RequestEvent) => relay(event, 'POST');
