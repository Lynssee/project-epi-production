// src/routes/api/kiosk/roll-call/+server.ts
// Rencana Absensi Istirahat v2, Fase 1 P2 — roll-call supervisor (cadangan saat kiosk mati
// atau area belum kebagian kiosk). Supervisor login kiosk dengan badge+PIN MILIKNYA SENDIRI
// (session.karyawanId = supervisor), lalu memindai badge anggota regu secara beruntun,
// dikirim sebagai SATU batch. Beda dari /api/kiosk/absen-istirahat: di sini `diverifikasi_oleh`
// SELALU diisi (akuntabilitas jatuh ke supervisor) dan `metode_verifikasi='roll_call'`.
// Satu item gagal TIDAK menggagalkan seluruh batch — dikembalikan per-item.

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { closeIstirahatViaBadge } from '$lib/server/kioskIstirahat';
import { hashDeviceFingerprint } from '$lib/server/deviceFingerprint';

interface RollCallItem {
	no_badge: string;
	badge_token: string;
}

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);

	const body = await event.request.json().catch(() => null);
	const items: RollCallItem[] = Array.isArray(body?.items) ? body.items : [];
	const workstationId = body?.workstation_id ?? null;

	if (items.length === 0) {
		return json({ results: [] });
	}
	if (items.length > 50) {
		return json({ results: [], error: 'Maksimal 50 badge per batch.' }, { status: 400 });
	}

	const deviceFingerprint = await hashDeviceFingerprint(event.request);

	const results = [];
	for (const item of items) {
		const noBadge = String(item?.no_badge || '').trim();
		const badgeToken = String(item?.badge_token || '').trim();
		try {
			const r = await closeIstirahatViaBadge({
				noBadge,
				badgeToken,
				workstationId,
				metodeVerifikasi: 'roll_call',
				diverifikasiOleh: session.karyawanId,
				foto: null,
				deviceFingerprint
			});
			results.push({ no_badge: noBadge, success: true, nama: r.nama, overrunMenit: r.overrunMenit, tier: r.tier, modeGerbang: r.modeGerbang });
		} catch (e: any) {
			const message = e?.body?.message || e?.message || 'Gagal mencatat.';
			results.push({ no_badge: noBadge, success: false, message });
		}
	}

	return json({ results, diverifikasiOleh: session.nama });
};
