// src/routes/api/verifikasi/[jenis]/[id]/+server.ts
// Verifikasi keaslian dokumen lewat QR — PUBLIK (tanpa login). Logika & keamanan: $lib/server/verifikasiService.ts.
// Data keluar = whitelist minimal (nomor, jenis, status, tanggal, nominal). Respons selalu no-store & noindex.
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { isRateLimited } from '$lib/server/rateLimit';
import { readSecret } from '$lib/server/verifikasiDokumen';
import { loadVerifikasi } from '$lib/server/verifikasiLoader';
import { verifikasiPublik } from '$lib/server/verifikasiService';

export const GET: RequestHandler = async (event) => {
	const result = await verifikasiPublik(
		{
			jenis: event.params.jenis,
			id: event.params.id,
			sig: event.url.searchParams.get('s'),
			ip: event.getClientAddress?.() || 'unknown'
		},
		{ secret: readSecret(env.DOKUMEN_VERIFIKASI_HMAC_SECRET), isRateLimited, load: loadVerifikasi }
	);
	return json(result.body, {
		status: result.status,
		headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' }
	});
};
