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
import { verifyFace } from '$lib/server/ess/faceVerify';
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
	const existing = await findTodayRecord(karyawan.id, tanggal);
	if (existing && !isEmptyTime(existing.jam_masuk)) {
		throw error(409, 'Anda sudah absen masuk hari ini.');
	}

	// Fase 5 (rencana Optimasi Inventory & Produksi + Deposit HP + Kiosk Produksi v2, 24 Agu 2026).
	// Default phone_deposit.mode_gerbang = "off" -- gerbang ini TIDAK PERNAH memblokir siapa pun
	// sampai admin menyalakannya manual dari panel setelan setelah ada persetujuan tertulis.
	const depositGate = await checkPhoneDepositGate(karyawan.id, karyawan.divisi);
	if (depositGate.blocked) {
		throw error(403, depositGate.message || 'Absen masuk ditahan — belum setor HP.');
	}

	// Tentukan lokasi target: dipilih klien, atau lokasi aktif terdekat dari device.
	let lokasi = lokasiAbsensiId ? await getLokasiById(lokasiAbsensiId) : null;
	if (!lokasi) {
		const activeLokasi = await listActiveLokasi();
		lokasi = nearestLokasi(lat, lng, activeLokasi);
	}
	if (!lokasi) {
		throw error(400, 'Belum ada titik lokasi absensi yang dikonfigurasi. Hubungi HRD.');
	}

	const { valid: masukValid, jarak } = withinRadius(lat, lng, lokasi.lat, lokasi.lng, lokasi.radius_m);

	// Foto TIDAK di-block bila di luar radius — tetap tercatat untuk review HRD.
	const uploadForm = new FormData();
	uploadForm.append('file', foto, `absen-masuk-${karyawan.id}-${Date.now()}.jpg`);
	const uploadRes = await directusServerUpload(uploadForm);
	if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto ke server.');
	const uploaded = await uploadRes.json();
	const fotoId = uploaded?.data?.id;
	if (!fotoId) throw error(502, 'Gagal mengunggah foto ke server.');

	const deviceInfo = event.request.headers.get('user-agent') || '';
	const ipAddress = event.getClientAddress();

	// Face recognition Fase 1 — fail-safe bukan fail-closed: hasil dicatat, clock-in tetap
	// jalan meski verifikasi gagal (mis. wajah belum enroll, microservice down).
	const faceResult = await verifyFace({
		karyawanId: karyawan.id,
		foto,
		context: 'clock_in',
		livenessPassed,
		ipAddress,
		deviceInfo,
		lokasiAbsensiId
	});

	// Anti-fake-GPS Fase 1 (web-only): heuristic accuracy + velocity vs titik terakhir.
	const lastPoint = await findLastKnownPoint(karyawan.id, tanggal);
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
		face_verify_masuk_id: faceResult.verificationId,
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

	return json({
		record: result?.data ?? result,
		masukValid,
		jarak,
		faceVerified: faceResult.passed,
		antiFakeGpsScore,
		phoneDepositWarning: depositGate.warned ? depositGate.message : null
	});
};
