import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import {
	findLastKnownPoint,
	findTodayRecord,
	getLokasiById,
	isEmptyTime,
	listActiveLokasi,
	nearestLokasi
} from '$lib/server/ess/absensi';
import { computeAntiFakeGpsScore, withinRadius } from '$lib/server/ess/geo';
import { nowTimeJakarta, todayJakarta } from '$lib/server/ess/time';
import { verifyFaceInBackground } from '$lib/server/ess/faceVerify';
import { attendanceLockKey, withAttendanceLock } from '$lib/server/ess/attendanceLock';
import { checkPhoneDepositGate } from '$lib/server/phoneDepositGate';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const form = await event.request.formData();
	const lat = Number(form.get('lat'));
	const lng = Number(form.get('lng'));
	const accuracy = form.get('accuracy') != null ? Number(form.get('accuracy')) : null;
	const lokasiAbsensiId = form.get('lokasi_absensi_id')?.toString() || null;
	const foto = form.get('foto');
	const livenessPassed = form.get('liveness_passed') === 'true' || form.get('liveness_passed') === '1';

	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		throw error(400, 'Lokasi GPS tidak valid. Aktifkan izin lokasi dan coba lagi.');
	}
	if (!(foto instanceof File) || foto.size === 0) {
		throw error(400, 'Foto selfie wajib diambil.');
	}

	const tanggal = todayJakarta();
	const deviceInfo = event.request.headers.get('user-agent') || '';
	const ipAddress = event.getClientAddress();

	const responseBody = await withAttendanceLock(attendanceLockKey('clock_in', karyawan.id, tanggal), async () => {
		const [existing, depositGate, activeLokasi, lastPoint] = await Promise.all([
			findTodayRecord(karyawan.id, tanggal),
			checkPhoneDepositGate(karyawan.id, karyawan.divisi),
			listActiveLokasi(),
			findLastKnownPoint(karyawan.id, tanggal)
		]);

		if (existing && !isEmptyTime(existing.jam_masuk)) {
			throw error(409, 'Anda sudah absen masuk hari ini.');
		}

		// Fase 5 (rencana Optimasi Inventory & Produksi + Deposit HP + Kiosk Produksi v2, 24 Agu 2026).
		// Default phone_deposit.mode_gerbang = "off" -- gerbang ini TIDAK PERNAH memblokir siapa pun
		// sampai admin menyalakannya manual dari panel setelan setelah ada persetujuan tertulis.
		if (depositGate.blocked) {
			throw error(403, depositGate.message || 'Absen masuk ditahan — belum setor HP.');
		}

		// Tentukan lokasi target: dipilih klien (cek cache aktif dulu), atau lokasi aktif terdekat dari device.
		let lokasi = lokasiAbsensiId
			? activeLokasi.find((l) => String(l.id) === String(lokasiAbsensiId)) || (await getLokasiById(lokasiAbsensiId))
			: null;
		if (!lokasi) {
			lokasi = nearestLokasi(lat, lng, activeLokasi);
		}
		if (!lokasi) {
			throw error(400, 'Belum ada titik lokasi absensi yang dikonfigurasi. Hubungi HRD.');
		}

		const { valid: masukValid, jarak } = withinRadius(lat, lng, lokasi.lat, lokasi.lng, lokasi.radius_m);

		// Foto TIDAK di-block bila di luar radius — tetap tercatat untuk review HRD.
		// Upload 1x saja ke Directus /files; fotoId dipakai ulang untuk face verify bila nanti aktif.
		const uploadForm = new FormData();
		uploadForm.append('file', foto, `absen-masuk-${karyawan.id}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto ke server.');
		const uploaded = await uploadRes.json();
		const fotoId = uploaded?.data?.id;
		if (!fotoId) throw error(502, 'Gagal mengunggah foto ke server.');

		// Anti-fake-GPS Fase 1 (web-only): heuristic accuracy + velocity vs titik terakhir.
		const antiFakeGpsScore = computeAntiFakeGpsScore({
			accuracy,
			previous: lastPoint,
			current: { lat, lng, atMs: Date.now() }
		});

		// Fase 4: karyawan yang sudah mengajukan "Izin Setengah Hari"/"Izin Terlambat" pagi ini
		// (lihat /api/ess/attendance/izin-sakit) tapi tetap datang kerja — status IZIN itu dipertahankan
		// (bukan ditimpa 'HADIR') supaya potongan proporsional (T3, payrollSync.js) tetap berlaku.
		const IZIN_PRESERVE_STATUSES = new Set(['IZIN 1/2 HARI', 'IZIN TERLAMBAT']);
		const existingStatus = String(existing?.status || '').toUpperCase();
		const preserveIzinStatus = IZIN_PRESERVE_STATUSES.has(existingStatus);

		const payload = {
			karyawan_id: String(karyawan.id),
			tanggal,
			status: preserveIzinStatus ? existingStatus : 'HADIR',
			jam_masuk: nowTimeJakarta(),
			jam_keluar: existing?.jam_keluar && !isEmptyTime(existing.jam_keluar) ? existing.jam_keluar : '-',
			lokasi: lokasi.nama,
			foto_selfie: fotoId,
			lat_masuk: lat,
			lng_masuk: lng,
			jarak_masuk_m: jarak,
			masuk_valid: masukValid,
			lokasi_absensi_id: lokasi.id,
			sumber: 'ESS',
			device_info: deviceInfo,
			ip_address: ipAddress,
			face_verify_masuk_id: null,
			anti_fake_gps_score: antiFakeGpsScore
		};

		const result = existing
			? await directusServerJson(`/items/absensi_harian/${existing.id}`, {
					method: 'PATCH',
					body: JSON.stringify(payload)
				})
			: await directusServerJson('/items/absensi_harian', {
					method: 'POST',
					body: JSON.stringify(payload)
				});

		const savedRecord = result?.data ?? result;
		const savedId = savedRecord?.id ?? existing?.id ?? null;

		// Face recognition (Opsi B): skip total bila belum ada enrollment di karyawan_face_data;
		// bila kelak sudah ada enrollment, jalankan non-blocking memakai ulang fotoId (0 upload ganda).
		verifyFaceInBackground(
			{
				karyawanId: karyawan.id,
				foto,
				context: 'clock_in',
				livenessPassed,
				ipAddress,
				deviceInfo,
				lokasiAbsensiId: lokasi.id,
				existingFotoId: fotoId,
				lokasiThreshold: lokasi.face_match_threshold ?? null,
				skipWhenUnenrolled: true
			},
			async (verificationId) => {
				if (!savedId) return;
				await directusServerJson(`/items/absensi_harian/${savedId}`, {
					method: 'PATCH',
					body: JSON.stringify({ face_verify_masuk_id: verificationId })
				});
			}
		);

		return {
			record: savedRecord,
			masukValid,
			jarak,
			faceVerified: false,
			antiFakeGpsScore,
			phoneDepositWarning: depositGate.warned ? depositGate.message : null
		};
	});

	return json(responseBody);
};
