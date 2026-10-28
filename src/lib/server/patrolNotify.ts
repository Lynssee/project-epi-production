// src/lib/server/patrolNotify.ts
// Fase 4.2 (Kontrol Patroli, 15 Sep 2026) — relay Submit ronda selesai ke hub terpusat di
// erp-epi-1 (/api/automation/notif-dispatch), pola sama persis dengan gaChecklistNotify.ts
// (FONNTE_TOKEN & registry event hanya ada di env/kode erp-epi-1, eventType
// patrol_low_compliance/patrol_anomaly_detected sudah didaftarkan di registry.js).
// Server-side (bukan klien) mengevaluasi kondisi trigger — tidak percaya skor/anomali
// dari klien. Gagal kirim TIDAK BOLEH menggagalkan alur selesai ronda — fail-soft.

import { env } from '$env/dynamic/private';
import { directusServerJson } from './directus';
import { getPatrolControlSettings } from './patrolControlSettings';

async function fetchGaGroupRecipients(): Promise<{ nama: string; no_telpon: string }[]> {
	try {
		const res = await directusServerJson<{ data: { nama: string; no_telpon: string }[] }>(
			`/items/hrd_notify_recipients?limit=-1&fields=nama,no_telpon&filter[active][_eq]=true`
		);
		return res?.data || [];
	} catch {
		return [];
	}
}

async function dispatch(eventType: string, message: string, opts: { sourceId?: string | number; actionUrl?: string }) {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!baseUrl || !secret) {
		console.warn('[patrolNotify] ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi — notifikasi dilewati.');
		return;
	}
	try {
		const waRecipients = await fetchGaGroupRecipients();
		await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/notif-dispatch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				secret,
				eventType,
				message,
				waRecipients,
				sourceCollection: 'security_patrol_log',
				sourceId: opts.sourceId != null ? String(opts.sourceId) : undefined,
				actionUrl: opts.actionUrl || '/hrd?tab=security',
				actionRequired: true,
				department: 'hrd'
			})
		});
	} catch (e) {
		console.warn('[patrolNotify] Gagal memanggil relay notif-dispatch erp-epi-1:', e);
	}
}

/**
 * Dipanggil dari /api/patrol-control/notify-ronda-selesai SETELAH finishPatrolLog. Fetch
 * ulang patrol_log + scan-nya dari Directus (bukan percaya klien) untuk menilai skor rendah
 * dan/atau anomali (override manual/speedrun, GPS luar radius, dwell prematur, ronda
 * dipercepat), lalu kirim alert bila salah satu terpenuhi.
 */
export async function notifyRondaSelesai(patrolLogId: number): Promise<void> {
	try {
		const settings = await getPatrolControlSettings();

		const logRes = await directusServerJson<{ data: any }>(`/items/security_patrol_log/${patrolLogId}`);
		const log = logRes?.data;
		if (!log) return;

		const scansRes = await directusServerJson<{ data: any[] }>(
			`/items/security_patrol_scan?${new URLSearchParams({
				'filter[patrol_log_id][_eq]': String(patrolLogId),
				fields: 'override_reason,in_radius,mulai_kerja,dwell_override_reason',
				limit: '-1'
			}).toString()}`
		);
		const scans = scansRes?.data || [];
		const anomaliCount =
			scans.filter((s) => s.override_reason && !s.mulai_kerja).length +
			scans.filter((s) => s.in_radius === false).length +
			scans.filter((s) => s.dwell_override_reason).length +
			(log.durasi_override_reason ? 1 : 0);

		const satpamRes = await directusServerJson<{ data: any }>(`/items/karyawan/${log.satpam_id}?fields=nama_karyawan`).catch(() => null);
		const namaPetugas = satpamRes?.data?.nama_karyawan || `Petugas #${log.satpam_id}`;

		const skor = log.skor_kepatuhan;
		if (skor != null && skor < settings.patrolLowComplianceThreshold) {
			await dispatch(
				'patrol_low_compliance',
				`⚠️ Skor kepatuhan ronda ${namaPetugas} hanya ${skor}% (ambang ${settings.patrolLowComplianceThreshold}%).`,
				{ sourceId: patrolLogId }
			);
		} else if (anomaliCount > 0) {
			await dispatch(
				'patrol_anomaly_detected',
				`🔎 ${anomaliCount} anomali terdeteksi pada ronda ${namaPetugas} (override manual/speedrun, GPS luar radius, atau durasi dipercepat).`,
				{ sourceId: patrolLogId }
			);
		}
	} catch (e) {
		console.warn('[patrolNotify] gagal evaluasi/kirim notifikasi ronda selesai:', e);
	}
}
