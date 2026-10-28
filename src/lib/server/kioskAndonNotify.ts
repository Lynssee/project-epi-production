// src/lib/server/kioskAndonNotify.ts
// Relay "Panggil Supervisor" (Andon) dari Kiosk Produksi ke hub notifikasi terpusat erp-epi-1.
// Fase 2D rencana "Pertajam Modul Kiosk Produksi v2" (12 Sep 2026) — sebelumnya tombol ini
// hanya toast statis di kiosk/+layout.svelte, tidak pernah mengirim apa pun.
//
// Pola sama persis maintenanceNotify.ts, TAPI secret-nya BEDA: notif-dispatch memakai
// AUTOMATION_SERVER_SECRET, bukan PRODUCTION_AUTOMATION_SECRET yang dipakai endpoint
// qc-kiosk/production. Jangan tertukar (lihat rencana §2D catatan K2).

import { env } from '$env/dynamic/private';

interface KioskAndonPayload {
	eventType:
		| 'kiosk_supervisor_call'
		| 'kiosk_overproduction_detected'
		| 'kiosk_spk_status_shadow_warning'
		| 'kiosk_spk_start_request';
	message: string;
	waKaryawanIds?: number[];
	karyawanId?: number | null;
	sourceId?: string | number | null;
	actionUrl?: string;
}

/** Fire-and-forget relay ke notif-dispatch. Kegagalan TIDAK BOLEH menggagalkan aksi kiosk
 *  yang memicunya (panggilan supervisor / submit produksi) — hanya dicatat di log server. */
export async function notifyKioskAndon(payload: KioskAndonPayload): Promise<boolean> {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!baseUrl || !secret) {
		console.warn('[kioskAndonNotify] ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi — notifikasi dilewati.');
		return false;
	}
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/notif-dispatch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				secret,
				eventType: payload.eventType,
				message: payload.message,
				waKaryawanIds: payload.waKaryawanIds || [],
				karyawanId: payload.karyawanId ?? null,
				sourceCollection: 'karyawan',
				sourceId: payload.sourceId != null ? String(payload.sourceId) : null,
				actionUrl: payload.actionUrl || '/production/control-tower',
				actionRequired: true,
				department: 'production'
			})
		});
		return res.ok;
	} catch (e) {
		console.warn('[kioskAndonNotify] Gagal memanggil relay notif-dispatch erp-epi-1:', e);
		return false;
	}
}
