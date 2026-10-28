// src/routes/api/kiosk/login/+server.ts
// Login kiosk badge + PIN — Fase 2, rencana Optimasi Inventory & Produksi + Deposit HP + Kiosk
// Produksi v2 (24 Agu 2026). TIDAK memakai Firebase Auth (operator shift tidak punya akun
// pribadi) -- validasi PIN 100% server-side, rate-limited, sesi ditandatangani HMAC.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import { verifyPin, verifyBadgeToken, signKioskSession, KIOSK_COOKIE_NAME } from '$lib/server/kioskAuth';
import { isRateLimited } from '$lib/server/rateLimit';
import { parseEpiQr } from '$lib/utils/qrParse';

/** Hasil scan kartu (URL /scan/… atau EPI:BADGE:…) ATAU no. badge diketik manual. */
function resolveBadgeInput(raw: string): { noBadge: string; token: string | null } {
	const parsed = parseEpiQr(raw);
	if (parsed?.type === 'BADGE') return { noBadge: String(parsed.id), token: parsed.token ?? null };
	return { noBadge: raw, token: null };
}

function getClientIp(event: Parameters<RequestHandler>[0]): string {
	try {
		return (
			event.request.headers.get('cf-connecting-ip') ||
			event.request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
			event.request.headers.get('x-real-ip') ||
			event.getClientAddress?.() ||
			'127.0.0.1'
		);
	} catch {
		return event.request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
	}
}

export const POST: RequestHandler = async (event) => {
	try {
		const key = `kiosk-login:${getClientIp(event)}`;
		if (isRateLimited(key, { windowMs: 5 * 60 * 1000, max: 20 })) {
			throw error(429, 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.');
		}

		const body = await event.request.json().catch(() => null);
		const badgeRaw = String(body?.badge || '').trim();
		const pin = String(body?.pin || '').trim();
		if (!badgeRaw || !pin) throw error(400, 'Badge dan PIN wajib diisi.');

		const { noBadge, token: badgeToken } = resolveBadgeInput(badgeRaw);

		const res = await directusServerJson<{ data: any[] }>(
			`/items/karyawan?filter[no_badge][_eq]=${encodeURIComponent(noBadge)}` +
				`&filter[kiosk_enabled][_eq]=true` +
				`&filter[status_kerja][_neq]=${encodeURIComponent('Tidak Aktif')}` +
				`&fields=id,nama_karyawan,pin_hash,badge_qr_rev&limit=1`
		);
		const karyawan = res?.data?.[0];

		// Kartu fisik membawa token: tolak kartu lama/hilang (badge_qr_rev sudah dinaikkan HRD).
		if (karyawan && badgeToken && !verifyBadgeToken(noBadge, karyawan.badge_qr_rev, badgeToken)) {
			throw error(401, 'Kartu badge ini sudah tidak berlaku (diganti/hilang). Minta kartu baru ke HRD.');
		}
		if (!karyawan || !verifyPin(pin, karyawan.pin_hash)) {
			throw error(401, 'Badge atau PIN salah, atau akun ini belum diaktifkan untuk kiosk. Hubungi admin.');
		}

		const sessionToken = signKioskSession({ karyawanId: karyawan.id, nama: karyawan.nama_karyawan });
		event.cookies.set(KIOSK_COOKIE_NAME, sessionToken, {
			path: '/',
			httpOnly: true,
			secure: event.url.protocol === 'https:',
			sameSite: 'lax',
			maxAge: 8 * 60 * 60
		});

		return json({ success: true, karyawan: { id: karyawan.id, nama: karyawan.nama_karyawan } });
	} catch (err: any) {
		if (err?.status && err?.body) throw err;
		console.error('[kiosk/login] Error during login:', err);
		throw error(500, err?.message || 'Terjadi kesalahan pada server saat login kiosk.');
	}
};
