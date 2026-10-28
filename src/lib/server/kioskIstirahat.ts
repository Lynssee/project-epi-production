// src/lib/server/kioskIstirahat.ts
// Rencana Absensi Istirahat v2, Fase 1 — logika bersama "tutup jeda istirahat via badge",
// dipakai kiosk tap tunggal (P1, /api/kiosk/absen-istirahat) DAN roll-call supervisor batch
// (P2, /api/kiosk/roll-call) supaya tidak duplikat validasi/rollup. Mesin inti
// (loadIstirahatConfig/findJedaTerbuka/validateBreakPunch/rollupIstirahat) TIDAK diubah.

import { error } from '@sveltejs/kit';
import { verifyBadgeToken } from '$lib/server/kioskAuth';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { isRateLimited } from '$lib/server/rateLimit';
import { findTodayRecord } from '$lib/server/ess/absensi';
import { nowTimeJakarta, todayJakarta } from '$lib/server/ess/time';
import { loadIstirahatConfig, getJendelaIstirahat, findJedaTerbuka, validateBreakPunch, rollupIstirahat } from '$lib/server/ess/istirahat';

function parseHHmmToMinutes(str: string | null | undefined): number | null {
	if (!str || typeof str !== 'string' || str === '-') return null;
	const parts = str.split(':');
	if (parts.length < 2) return null;
	const h = Number(parts[0]);
	const m = Number(parts[1]);
	if (Number.isNaN(h) || Number.isNaN(m)) return null;
	return h * 60 + m;
}

export interface CloseIstirahatViaBadgeParams {
	noBadge: string;
	badgeToken: string;
	workstationId: string | number | null;
	metodeVerifikasi: 'kiosk_badge' | 'roll_call';
	diverifikasiOleh: number | null; // karyawan_id supervisor (roll-call) — null untuk kiosk mandiri
	foto?: File | null;
	// Hash User-Agent+Accept-Language perangkat pemanggil (dihitung di +server.ts dari header
	// request, sama seperti site-checkin.ts) — dipakai utk cek device_fingerprint_terdaftar.
	deviceFingerprint?: string | null;
}

export interface CloseIstirahatViaBadgeResult {
	karyawanId: number;
	nama: string;
	overrunMenit: number;
	tier: number;
	modeGerbang: string;
}

/**
 * Tutup jeda istirahat terbuka milik karyawan yang badge-nya di-scan. Melempar SvelteKit
 * `error()` (400/401/403/404/409/429) bila ditolak — pemanggil batch (roll-call) HARUS
 * menangkap per-item, pemanggil tunggal (kiosk) boleh biarkan menjalar ke response.
 */
export async function closeIstirahatViaBadge(params: CloseIstirahatViaBadgeParams): Promise<CloseIstirahatViaBadgeResult> {
	const { noBadge, badgeToken, workstationId, metodeVerifikasi, diverifikasiOleh, foto, deviceFingerprint } = params;

	if (!noBadge || !badgeToken) throw error(400, 'Badge tidak terbaca. Coba tempelkan ulang.');

	// Anti-titip perangkat: kalau workstation ini SUDAH punya device_fingerprint_terdaftar
	// (diisi HRD, atau otomatis pada tap pertama di bawah), tap dari perangkat lain ditolak.
	// Kosong = belum dikunci, tidak ditegakkan (fail-open) — sesuai hint UI "opsional".
	let workstationFingerprintBaru: { id: string | number; belumTerdaftar: boolean } | null = null;
	if (workstationId) {
		const wsRes = await directusServerJson<{ data: { device_fingerprint_terdaftar: string | null } | null }>(
			`/items/master_workstation/${workstationId}?fields=device_fingerprint_terdaftar`
		).catch(() => null);
		const terdaftar = wsRes?.data?.device_fingerprint_terdaftar || null;
		if (terdaftar) {
			if (deviceFingerprint && terdaftar !== deviceFingerprint) {
				throw error(403, 'Perangkat kiosk ini tidak cocok dengan yang terdaftar untuk meja ini. Hubungi HRD.');
			}
		} else if (deviceFingerprint) {
			workstationFingerprintBaru = { id: workstationId, belumTerdaftar: true };
		}
	}

	// Anti-spam satu badge / 60 detik (rencana v2 §3.3.1 anti-titip berlapis butir 3) — berlaku
	// utk kedua jalur (kiosk maupun roll-call) supaya badge yang sama tak diproses dobel.
	const rlKey = `kiosk-absen-istirahat:${noBadge}`;
	if (isRateLimited(rlKey, { windowMs: 60 * 1000, max: 1 })) {
		throw error(429, 'Badge ini baru saja tap. Tunggu sebentar sebelum tap lagi.');
	}

	const karyawanRes = await directusServerJson<{ data: any[] }>(
		`/items/karyawan?filter[no_badge][_eq]=${encodeURIComponent(noBadge)}&filter[kiosk_enabled][_eq]=true` +
			`&filter[status_kerja][_neq]=${encodeURIComponent('Tidak Aktif')}&fields=id,nama_karyawan,badge_qr_rev&limit=1`
	);
	const karyawan = karyawanRes?.data?.[0];
	if (!karyawan) {
		throw error(404, 'Badge tidak dikenali, atau kiosk belum diaktifkan untuk karyawan ini. Hubungi HRD.');
	}
	if (!verifyBadgeToken(noBadge, karyawan.badge_qr_rev, badgeToken)) {
		throw error(401, 'Kartu badge tidak valid atau sudah dicabut (kartu hilang/diganti). Hubungi HRD untuk kartu baru.');
	}

	const { aktif, konfig } = await loadIstirahatConfig();
	if (!aktif) {
		throw error(403, 'Fitur absen istirahat mandiri belum diaktifkan. Hubungi HRD.');
	}

	const tanggal = todayJakarta();
	const absensiRecord = await findTodayRecord(karyawan.id, tanggal);
	if (!absensiRecord) {
		throw error(403, `${karyawan.nama_karyawan} belum absen masuk hari ini.`);
	}

	const [jedaTerbuka, jendela] = await Promise.all([
		findJedaTerbuka(absensiRecord.id),
		getJendelaIstirahat(karyawan.id)
	]);
	const rejectMsg = validateBreakPunch({
		jenis: 'break-in',
		absensiRecord,
		jedaTerbuka,
		jendela,
		config: konfig,
		nowHHmm: nowTimeJakarta(),
		toleransiJendelaMenitOverride: Number(konfig?.istirahat_toleransi_bel_produksi_menit) || undefined
	});
	if (rejectMsg) throw error(409, `${karyawan.nama_karyawan}: ${rejectMsg}`);
	const jeda = jedaTerbuka!;

	let fotoId: string | null = null;
	if (foto instanceof File && foto.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', foto, `istirahat-kiosk-${karyawan.id}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (uploadRes.ok) {
			const uploaded = await uploadRes.json();
			fotoId = uploaded?.data?.id ?? null;
		}
		// Gagal unggah foto TIDAK memblokir absen (fail-open, sama seperti prinsip §8.1) —
		// snapshot webcam kiosk adalah lapisan anti-titip tambahan, bukan syarat mutlak.
	}

	const jamMasuk = nowTimeJakarta();
	const keluarMin = parseHHmmToMinutes(jeda.jam_keluar);
	let masukMin = parseHHmmToMinutes(jamMasuk);
	let durasiMenit: number | null = null;
	if (keluarMin != null && masukMin != null) {
		if (masukMin <= keluarMin) masukMin += 1440;
		durasiMenit = masukMin - keluarMin;
	}

	await directusServerJson(`/items/absensi_istirahat_log/${jeda.id}`, {
		method: 'PATCH',
		body: JSON.stringify({
			jam_masuk: jamMasuk,
			foto_masuk: fotoId,
			masuk_valid: true, // Lokasi kiosk sudah terdaftar & tetap — tidak dicek GPS per-tap.
			durasi_menit: durasiMenit,
			metode_verifikasi: metodeVerifikasi,
			workstation_id: workstationId ? Number(workstationId) : null,
			diverifikasi_oleh: diverifikasiOleh,
			sumber: diverifikasiOleh ? 'Admin' : 'Auto'
		})
	});

	await rollupIstirahat(absensiRecord.id);

	// Heartbeat kiosk + kunci fingerprint perangkat pada tap pertama (TOFU) — best-effort,
	// tidak boleh menggagalkan absen kalau ini error.
	if (workstationId) {
		const patchBody: Record<string, unknown> = { heartbeat_terakhir: new Date().toISOString() };
		if (workstationFingerprintBaru?.belumTerdaftar) {
			patchBody.device_fingerprint_terdaftar = deviceFingerprint;
		}
		directusServerJson(`/items/master_workstation/${workstationId}`, {
			method: 'PATCH',
			body: JSON.stringify(patchBody)
		}).catch(() => {});
	}

	const updated = await findTodayRecord(karyawan.id, tanggal);

	return {
		karyawanId: karyawan.id,
		nama: karyawan.nama_karyawan,
		overrunMenit: updated?.istirahat_overrun_menit ?? 0,
		tier: updated?.istirahat_tier ?? 0,
		modeGerbang: konfig?.istirahat_mode_gerbang ?? 'off'
	};
}
