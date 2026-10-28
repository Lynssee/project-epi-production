// src/routes/api/ess/izin-jam/gate-scan/+server.ts
// ESS HRD v3 Fase 2 — satpam scan QR pass izin jam-jaman. Arah (out/in) ditentukan
// OTOMATIS dari status request (bukan pilihan manual satpam) — scan pertama selalu
// keluar, scan kedua selalu masuk; scan ketiga otomatis ditolak karena status sudah
// 'selesai'. Reuse security_gate_person_log + mekanisme pairing yang sudah ada
// (out<->in lewat paired_id), ditambah izin_jam_ref_id utk telusur balik.

import { createHash } from 'node:crypto';
import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getUserPermissions, hasAnyPermission } from '$lib/server/rbacServer';
import { directusServerJson } from '$lib/server/directus';

function sha256Hex(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

interface IzinJamRow {
	id: string;
	status: string;
	karyawan_id: number;
	estimasi_durasi_jam: number;
	qr_token_hash: string | null;
	qr_token_expires_at: string | null;
	gate_log_out_id: number | null;
}

export async function POST(event: RequestEvent) {
	const user = await requireUser(event);
	const authHeader = event.request.headers.get('authorization') || '';
	const idToken = authHeader.replace(/^Bearer\s+/i, '');
	const { permissions } = await getUserPermissions(idToken, user.localId, { email: user.email });
	if (!hasAnyPermission(permissions, 'gate_log')) {
		throw error(403, 'Tidak punya izin scan gate.');
	}

	const body = await event.request.json().catch(() => ({}));
	const raw = String(body?.qrValue || '');
	const match = raw.match(/^IZINJAM:([0-9a-fA-F-]+):([0-9a-fA-F]+)$/);
	if (!match) {
		throw error(400, 'QR tidak valid untuk izin jam-jaman.');
	}
	const [, izinJamId, rawToken] = match;

	const izinJamRes = await directusServerJson<{ data: IzinJamRow }>(
		`/items/izin_jam_request/${izinJamId}?fields=id,status,karyawan_id,estimasi_durasi_jam,qr_token_hash,qr_token_expires_at,gate_log_out_id`
	);
	const izinJam = izinJamRes?.data;
	if (!izinJam) throw error(404, 'Pengajuan izin tidak ditemukan.');

	if (!izinJam.qr_token_hash || sha256Hex(rawToken) !== izinJam.qr_token_hash) {
		throw error(400, 'Token QR tidak valid.');
	}
	if (!izinJam.qr_token_expires_at || new Date(izinJam.qr_token_expires_at).getTime() < Date.now()) {
		throw error(400, 'QR pass sudah kedaluwarsa (30 menit).');
	}

	if (izinJam.status === 'disetujui') {
		// Scan pertama — keluar
		const gateLog = await directusServerJson<{ data: { id: number } }>('/items/security_gate_person_log', {
			method: 'POST',
			body: JSON.stringify({
				tipe: 'tetap',
				karyawan_id: izinJam.karyawan_id,
				arah: 'out',
				keperluan: 'izin_jam',
				izin_jam_ref_id: izinJamId,
				waktu: new Date().toISOString()
			})
		});
		const gateLogId = gateLog?.data?.id;
		await directusServerJson(`/items/izin_jam_request/${izinJamId}`, {
			method: 'PATCH',
			body: JSON.stringify({ status: 'out_scanned', jam_keluar_aktual: new Date().toISOString(), gate_log_out_id: gateLogId })
		});
		return json({ arah: 'out', status: 'out_scanned' });
	}

	if (izinJam.status === 'out_scanned') {
		// Scan kedua — masuk
		const gateLog = await directusServerJson<{ data: { id: number } }>('/items/security_gate_person_log', {
			method: 'POST',
			body: JSON.stringify({
				tipe: 'tetap',
				karyawan_id: izinJam.karyawan_id,
				arah: 'in',
				keperluan: 'izin_jam',
				izin_jam_ref_id: izinJamId,
				paired_id: izinJam.gate_log_out_id,
				waktu: new Date().toISOString()
			})
		});
		const gateLogInId = gateLog?.data?.id;
		if (izinJam.gate_log_out_id) {
			await directusServerJson(`/items/security_gate_person_log/${izinJam.gate_log_out_id}`, {
				method: 'PATCH',
				body: JSON.stringify({ paired_id: gateLogInId })
			});
		}

		const jamMasukAktual = new Date();
		const existing = await directusServerJson<{ data: { jam_keluar_aktual: string } }>(
			`/items/izin_jam_request/${izinJamId}?fields=jam_keluar_aktual`
		);
		const jamKeluarAktual = existing?.data?.jam_keluar_aktual ? new Date(existing.data.jam_keluar_aktual) : jamMasukAktual;
		const durasiJam = Math.max(0, (jamMasukAktual.getTime() - jamKeluarAktual.getTime()) / 3_600_000);
		const lewatEstimasi = durasiJam > (izinJam.estimasi_durasi_jam || 0);

		await directusServerJson(`/items/izin_jam_request/${izinJamId}`, {
			method: 'PATCH',
			body: JSON.stringify({
				status: 'selesai',
				jam_masuk_aktual: jamMasukAktual.toISOString(),
				gate_log_in_id: gateLogInId,
				durasi_aktual_jam: Math.round(durasiJam * 100) / 100,
				lewat_estimasi: lewatEstimasi
			})
		});

		// project-epi tidak punya sendFonnte/WA sender (hanya ada di erp-epi-1) — alert WA
		// HRD+atasan utk lewat_estimasi=true ditangani oleh cron izin_jam_overdue_scan di
		// erp-epi-1 (jalan tiap 15 menit, lihat api/automation/hrd-payroll-notify) yang
		// membaca flag ini, bukan dikirim real-time dari sini. Fase 2: tidak buat sanksi
		// otomatis — kebijakan denda izin-jam-lewat-estimasi belum disepakati HRD.

		return json({ arah: 'in', status: 'selesai', durasiAktualJam: durasiJam, lewatEstimasi });
	}

	throw error(409, `Izin ini sudah ${izinJam.status === 'selesai' ? 'selesai' : izinJam.status} — QR tidak berlaku lagi.`);
}
