// src/routes/api/ess/attendance/break-in/+server.ts
// Fase 1 Absensi Istirahat (Foto Wajib) — kembali dari istirahat. Foto WAJIB (keputusan #1),
// GPS wajib, face-verify (fail-safe, bukan fail-closed — pola sama seperti clock-in/out).
// Menutup jeda terbuka di absensi_istirahat_log, lalu memanggil rollupIstirahat() supaya
// absensi_harian.jam_istirahat_* / istirahat_overrun_menit / istirahat_tier ikut ter-update.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { findTodayRecord, getLokasiById, listActiveLokasi, nearestLokasi } from '$lib/server/ess/absensi';
import { computeAntiFakeGpsScore, withinRadius } from '$lib/server/ess/geo';
import { nowTimeJakarta, todayJakarta } from '$lib/server/ess/time';
import { verifyFaceInBackground } from '$lib/server/ess/faceVerify';
import { attendanceLockKey, withAttendanceLock } from '$lib/server/ess/attendanceLock';
import { loadIstirahatConfig, getJendelaIstirahat, findJedaTerbuka, validateBreakPunch, rollupIstirahat } from '$lib/server/ess/istirahat';
import { resolveKaryawanPolaKerja } from '$lib/server/ess/polaKerjaResolver';
import { gatherMobileKonteksKualitas, type KonteksLokasi } from '$lib/server/ess/istirahatMobileContext';

const VALID_KONTEKS_OVERRIDE: KonteksLokasi[] = ['kantor', 'site_proyek', 'customer', 'perjalanan', 'luar_area'];
import { tryBindWorkstation } from '$lib/server/ess/workstationBinding';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const form = await event.request.formData();
	const lat = Number(form.get('lat'));
	const lng = Number(form.get('lng'));
	const accuracy = form.get('accuracy') != null ? Number(form.get('accuracy')) : null;
	const lokasiAbsensiId = form.get('lokasi_absensi_id')?.toString() || null;
	const foto = form.get('foto');
	const livenessPassed = form.get('liveness_passed') === 'true' || form.get('liveness_passed') === '1';
	// Fase 2 (rencana v2 §3.2) — deklarasi "masih di jalan" dipakai fallback klasifikasi konteks
	// bila tidak ada geofence/site_checkin yang cocok. HANYA dipakai utk pola kerja mobile.
	const perjalanan = form.get('perjalanan') === 'true' || form.get('perjalanan') === '1';
	// Rencana v2 §5 Fase 2 — tombol "Ubah lokasi": karyawan mengoreksi chip konteks otomatis
	// SEBELUM submit (lihat /api/ess/attendance/konteks-preview). Nilai tak dikenal diabaikan
	// (fail-open, kembali ke deteksi otomatis) daripada menolak seluruh absen.
	const konteksOverrideRaw = form.get('konteks_override')?.toString() || null;
	const konteksOverride: KonteksLokasi | null = VALID_KONTEKS_OVERRIDE.includes(konteksOverrideRaw as KonteksLokasi)
		? (konteksOverrideRaw as KonteksLokasi)
		: null;
	// Fase 3 (rencana v2 §3.1) — Dynamic Screen QR meja desk, dipindai dari layar PC sendiri.
	// Opsional & fail-open: gagal verifikasi TIDAK memblokir absen, hanya tidak terikat meja.
	const wstnPayload = form.get('wstn_payload')?.toString() || null;

	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		throw error(400, 'Lokasi GPS tidak valid. Aktifkan izin lokasi dan coba lagi.');
	}
	if (!(foto instanceof File) || foto.size === 0) {
		throw error(400, 'Foto wajib diambil saat kembali dari istirahat.');
	}

	const tanggal = todayJakarta();
	const deviceInfo = event.request.headers.get('user-agent') || '';
	const ipAddress = event.getClientAddress();

	const responseBody = await withAttendanceLock(attendanceLockKey('break_in', karyawan.id, tanggal), async () => {
		const [istirahatConfig, polaKerja, absensiRecord, jendela, activeLokasi] = await Promise.all([
			loadIstirahatConfig(),
			resolveKaryawanPolaKerja(karyawan.id, { polaKerja: karyawan.pola_kerja, divisi: karyawan.divisi }),
			findTodayRecord(karyawan.id, tanggal),
			getJendelaIstirahat(karyawan.id, karyawan.jadwal_kerja_id),
			listActiveLokasi()
		]);

		const { aktif, konfig } = istirahatConfig;
		if (!aktif) {
			throw error(403, 'Fitur absen istirahat mandiri belum diaktifkan untuk akun Anda. Hubungi HRD.');
		}
		if (!absensiRecord) {
			throw error(409, 'Anda belum absen masuk hari ini.');
		}

		const targetLokasiId = lokasiAbsensiId || absensiRecord.lokasi_absensi_id || null;
		const cachedLokasi = targetLokasiId
			? activeLokasi.find((l) => String(l.id) === String(targetLokasiId)) || null
			: null;

		const [jedaTerbuka, workstationBinding, fallbackLokasi] = await Promise.all([
			findJedaTerbuka(absensiRecord.id),
			wstnPayload
				? tryBindWorkstation({ karyawanId: karyawan.id, lat, lng, payload: wstnPayload }).catch(() => null)
				: Promise.resolve(null),
			!cachedLokasi && targetLokasiId ? getLokasiById(targetLokasiId) : Promise.resolve(null)
		]);

		const rejectMsg = validateBreakPunch({
			jenis: 'break-in',
			absensiRecord,
			jedaTerbuka,
			jendela,
			config: konfig,
			nowHHmm: nowTimeJakarta(),
			toleransiJendelaMenitOverride: polaKerja === 'mobile' ? Number(konfig?.istirahat_toleransi_bel_mobile_menit) || undefined : undefined
		});
		if (rejectMsg) throw error(409, rejectMsg);
		// jedaTerbuka dijamin non-null setelah validateBreakPunch lolos untuk jenis 'break-in'.
		const jeda = jedaTerbuka!;

		const lokasi = cachedLokasi || fallbackLokasi || nearestLokasi(lat, lng, activeLokasi);

		let masukValid = true;
		let jarak: number | null = null;
		if (lokasi) {
			const radiusResult = withinRadius(lat, lng, lokasi.lat, lokasi.lng, lokasi.radius_m);
			masukValid = radiusResult.valid;
			jarak = radiusResult.jarak;
		}
		// Di luar geofence TIDAK diblokir (keputusan #5) kecuali istirahat_geofence_wajib diaktifkan —
		// tetap tercatat + flag masuk_valid=false, persis pola masuk_valid/pulang_valid existing.
		if (konfig?.istirahat_geofence_wajib && !masukValid) {
			throw error(400, `Anda di luar radius lokasi absensi (jarak ${jarak ?? '?'}m). Dekati lokasi kerja untuk absen kembali dari istirahat.`);
		}

		const previousPoint =
			jeda.lat_keluar != null && jeda.lng_keluar != null && jeda.jam_keluar
				? { lat: Number(jeda.lat_keluar), lng: Number(jeda.lng_keluar), atMs: Date.parse(`${tanggal}T${jeda.jam_keluar}:00+07:00`) }
				: null;
		const antiFakeGpsScore = computeAntiFakeGpsScore({
			accuracy,
			previous: previousPoint,
			current: { lat, lng, atMs: Date.now() }
		});

		// Upload foto 1x (dipakai ulang face verify bila aktif) paralel dengan mobileKonteks bila mobile.
		const uploadForm = new FormData();
		uploadForm.append('file', foto, `istirahat-masuk-${karyawan.id}-${Date.now()}.jpg`);

		const [uploadRes, mobileKonteks] = await Promise.all([
			directusServerUpload(uploadForm),
			polaKerja === 'mobile'
				? gatherMobileKonteksKualitas({
						karyawanId: karyawan.id,
						lat,
						lng,
						akurasiGpsM: accuracy,
						antiFakeGpsScore,
						fotoWajib: true, // foto WAJIB di break-in (lihat guard di atas) — sudah pasti ada di titik ini
						fotoDiambil: true,
						declaredPerjalanan: perjalanan,
						fotoDitunda: false,
						ambangRendah: Number(konfig?.istirahat_ambang_kualitas_rendah) || undefined,
						konteksOverride
					}).catch(() => null)
				: Promise.resolve(null)
		]);

		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto ke server.');
		const uploaded = await uploadRes.json();
		const fotoId = uploaded?.data?.id;
		if (!fotoId) throw error(502, 'Gagal mengunggah foto ke server.');

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
				lat_masuk: lat,
				lng_masuk: lng,
				jarak_masuk_m: jarak,
				masuk_valid: masukValid,
				face_verify_masuk_id: null,
				durasi_menit: durasiMenit,
				akurasi_gps_m: accuracy,
				...(workstationBinding
					? {
							workstation_id: workstationBinding.workstationId,
							scan_token_jti: workstationBinding.scanTokenJti,
							metode_verifikasi: 'dynamic_qr'
						}
					: {}),
				...(mobileKonteks
					? {
							konteks_lokasi: mobileKonteks.konteksLokasi,
							konteks_sumber: mobileKonteks.konteksSumber,
							kualitas_bukti: mobileKonteks.kualitasBukti,
							kualitas_label: mobileKonteks.kualitasLabel,
							site_checkin_id: mobileKonteks.siteCheckinId
						}
					: {})
			})
		});

		const rollup = await rollupIstirahat(absensiRecord.id);
		const updated = rollup.record ?? {
			...absensiRecord,
			istirahat_overrun_menit: rollup.overrunMenit,
			istirahat_tier: rollup.tier
		};

		verifyFaceInBackground(
			{
				karyawanId: karyawan.id,
				foto,
				context: 'break_in',
				livenessPassed,
				ipAddress,
				deviceInfo,
				lokasiAbsensiId: lokasi?.id ?? null,
				existingFotoId: fotoId,
				lokasiThreshold: lokasi?.face_match_threshold ?? null,
				skipWhenUnenrolled: true
			},
			async (verificationId) => {
				await Promise.allSettled([
					directusServerJson(`/items/absensi_istirahat_log/${jeda.id}`, {
						method: 'PATCH',
						body: JSON.stringify({ face_verify_masuk_id: verificationId })
					}),
					directusServerJson(`/items/absensi_harian/${absensiRecord.id}`, {
						method: 'PATCH',
						body: JSON.stringify({ face_verify_istirahat_masuk_id: verificationId })
					})
				]);
			}
		);

		return {
			record: updated,
			masukValid,
			jarak,
			faceVerified: false,
			antiFakeGpsScore,
			overrunMenit: updated?.istirahat_overrun_menit ?? rollup.overrunMenit,
			tier: updated?.istirahat_tier ?? rollup.tier,
			konteksLokasi: mobileKonteks?.konteksLokasi ?? null,
			kualitasLabel: mobileKonteks?.kualitasLabel ?? null,
			mejaTerverifikasi: !!workstationBinding,
			// Fase 4 (rencana v2 §5) — gerbang bertahap off/shadow/warn ('block' TIDAK PERNAH dipakai,
			// keputusan K5). 'warn' murni tampilan (peringatan di layar ESS/kiosk), tidak pernah
			// memblokir atau menulis potongan gaji. Klien yang memutuskan menampilkan peringatan atau
			// tidak berdasarkan field ini + tier.
			modeGerbang: konfig?.istirahat_mode_gerbang ?? 'off'
		};
	});

	return json(responseBody);
};

function parseHHmmToMinutes(str: string | null | undefined): number | null {
	if (!str || typeof str !== 'string' || str === '-') return null;
	const parts = str.split(':');
	if (parts.length < 2) return null;
	const h = Number(parts[0]);
	const m = Number(parts[1]);
	if (Number.isNaN(h) || Number.isNaN(m)) return null;
	return h * 60 + m;
}
