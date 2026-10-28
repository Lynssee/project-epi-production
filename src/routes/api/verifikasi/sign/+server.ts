// src/routes/api/verifikasi/sign/+server.ts
// Minta tautan verifikasi (QR) bertanda tangan untuk dokumen — TERAUTENTIKASI.
// Rahasia HMAC tidak pernah meninggalkan server; klien hanya menerima URL jadi untuk dijadikan QR.
// Otorisasi (sisi lapangan): HANYA pembuat pengajuan (created_by_email = email login). Tanpa ini, setiap staf bisa
// menarik nomor/nominal PA orang lain lewat QR yang ia minta sendiri. Jenis 'bdp' (voucher bayar) tidak tersedia di sini.
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { isRateLimited } from '$lib/server/rateLimit';
import { buildVerifyUrl, canonicalId, readSecret, signDokumen } from '$lib/server/verifikasiDokumen';

const BASE_DEFAULT = 'https://project.eltamaprimaindo.com';

export const POST: RequestHandler = async (event) => {
	const { user } = await authenticateEss(event);
	const secret = readSecret(env.DOKUMEN_VERIFIKASI_HMAC_SECRET);
	if (!secret) throw error(503, 'QR verifikasi belum diaktifkan.');

	const body = await event.request.json().catch(() => ({}));
	const cid = canonicalId(body?.id);
	if (body?.jenis !== 'pa' || !cid) throw error(400, 'Permintaan tidak valid.');

	if (isRateLimited(`verifikasi-sign:${user.email || 'anon'}`, { windowMs: 5 * 60_000, max: 60 })) {
		throw error(429, 'Terlalu banyak permintaan. Coba lagi sebentar.');
	}

	let creator = '';
	try {
		const res = await directusServerJson<{ data: { created_by_email?: string | null } }>(`/items/pengajuan_anggaran/${cid}?fields=id,created_by_email`);
		creator = String(res?.data?.created_by_email || '').trim().toLowerCase();
	} catch (e: any) {
		console.warn('[verifikasi/sign] pengajuan tak termuat:', e?.message || e);
	}
	// Respons sama untuk "tidak ada" dan "bukan milik Anda" — tidak membocorkan keberadaan dokumen.
	if (!creator || creator !== String(user.email || '').trim().toLowerCase()) throw error(403, 'Anda tidak berhak menerbitkan QR untuk dokumen ini.');

	const base = String(env.VERIFIKASI_BASE_URL || '').trim() || event.url.origin || BASE_DEFAULT;
	return json({ url: buildVerifyUrl(base, 'pa', cid, signDokumen(secret, 'pa', cid)) });
};
