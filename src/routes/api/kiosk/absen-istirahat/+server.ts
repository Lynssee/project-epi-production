// src/routes/api/kiosk/absen-istirahat/+server.ts
// Rencana Absensi Istirahat v2, Fase 1 — kiosk produksi tap badge = absen kembali dari
// istirahat (P1, inti permintaan K1+K3). Sesi kiosk HMAC yang sudah ada (kioskAuth.ts)
// dipakai hanya untuk membuktikan perangkat ini legitimately dalam mode kiosk — SUBJEK
// punch selalu karyawan yang badge-nya di-scan, BUKAN pemilik sesi kiosk (bisa beda orang
// tiap tap, satu kiosk melayani banyak karyawan berturut-turut).
//
// Logika inti (validasi + rollup) ada di $lib/server/kioskIstirahat.ts — dipakai bersama
// dengan /api/kiosk/roll-call (P2, batch oleh supervisor).

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { closeIstirahatViaBadge } from '$lib/server/kioskIstirahat';
import { hashDeviceFingerprint } from '$lib/server/deviceFingerprint';

export const POST: RequestHandler = async (event) => {
	// Membuktikan perangkat ini sedang dalam sesi kiosk aktif (siapa pun yang login-kan tadi).
	requireKioskSession(event);

	const form = await event.request.formData();
	const noBadge = String(form.get('no_badge') || '').trim();
	const badgeToken = String(form.get('badge_token') || '').trim();
	const workstationId = form.get('workstation_id')?.toString() || null;
	const foto = form.get('foto');
	const deviceFingerprint = await hashDeviceFingerprint(event.request);

	const result = await closeIstirahatViaBadge({
		noBadge,
		badgeToken,
		workstationId,
		metodeVerifikasi: 'kiosk_badge',
		diverifikasiOleh: null,
		foto: foto instanceof File ? foto : null,
		deviceFingerprint
	});

	return json({
		nama: result.nama,
		overrunMenit: result.overrunMenit,
		tier: result.tier,
		modeGerbang: result.modeGerbang
	});
};
