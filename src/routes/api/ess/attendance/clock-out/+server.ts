import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { findTodayRecord, getLokasiById, isEmptyTime, listActiveLokasi, nearestLokasi } from '$lib/server/ess/absensi';
import { computeAntiFakeGpsScore, withinRadius } from '$lib/server/ess/geo';
import { nowTimeJakarta, todayJakarta } from '$lib/server/ess/time';
import { verifyFace } from '$lib/server/ess/faceVerify';
import { loadIstirahatConfig, findJedaTerbuka, getKategoriNama } from '$lib/server/ess/istirahat';

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
	if (!existing || isEmptyTime(existing.jam_masuk)) {
		throw error(409, 'Anda belum absen masuk hari ini.');
	}
	if (!isEmptyTime(existing.jam_keluar)) {
		throw error(409, 'Anda sudah absen pulang hari ini.');
	}

	// Keputusan #2 (Absensi Istirahat Foto Wajib): absen pulang diblokir bila istirahat belum
	// ditutup, dikendalikan istirahat_blokir_pulang (default true). Cron 18:00 (fase lain) tetap
	// jadi jaring pengaman untuk kasus karyawan sudah pulang tanpa absen kembali.
	const istirahatConfig = await loadIstirahatConfig();
	if (istirahatConfig.aktif && istirahatConfig.konfig?.istirahat_blokir_pulang !== false) {
		const jedaTerbuka = await findJedaTerbuka(existing.id);
		if (jedaTerbuka) {
			const kategoriNama = jedaTerbuka.kategori_id ? await getKategoriNama(jedaTerbuka.kategori_id) : null;
			const detail = kategoriNama ? ` (${kategoriNama}, sejak ${jedaTerbuka.jam_keluar})` : ` (sejak ${jedaTerbuka.jam_keluar})`;
			throw error(409, `Anda belum absen kembali dari istirahat${detail}. Absen kembali dulu sebelum absen pulang.`);
		}
	}

	let lokasi = lokasiAbsensiId
		? await getLokasiById(lokasiAbsensiId)
		: existing.lokasi_absensi_id
			? await getLokasiById(existing.lokasi_absensi_id)
			: null;
	if (!lokasi) {
		const activeLokasi = await listActiveLokasi();
		lokasi = nearestLokasi(lat, lng, activeLokasi);
	}
	if (!lokasi) {
		throw error(400, 'Belum ada titik lokasi absensi yang dikonfigurasi. Hubungi HRD.');
	}

	const { valid: pulangValid, jarak } = withinRadius(lat, lng, lokasi.lat, lokasi.lng, lokasi.radius_m);

	const uploadForm = new FormData();
	uploadForm.append('file', foto, `absen-pulang-${karyawan.id}-${Date.now()}.jpg`);
	const uploadRes = await directusServerUpload(uploadForm);
	if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto ke server.');
	const uploaded = await uploadRes.json();
	const fotoId = uploaded?.data?.id;
	if (!fotoId) throw error(502, 'Gagal mengunggah foto ke server.');

	const deviceInfo = event.request.headers.get('user-agent') || '';
	const ipAddress = event.getClientAddress();

	const faceResult = await verifyFace({
		karyawanId: karyawan.id,
		foto,
		context: 'clock_out',
		livenessPassed,
		ipAddress,
		deviceInfo,
		lokasiAbsensiId: lokasi.id
	});

	// Anti-fake-GPS Fase 1 (web-only): bandingkan vs titik clock-in hari ini.
	const previousPoint =
		existing.lat_masuk != null && existing.lng_masuk != null && !isEmptyTime(existing.jam_masuk)
			? { lat: Number(existing.lat_masuk), lng: Number(existing.lng_masuk), atMs: Date.parse(`${tanggal}T${existing.jam_masuk}:00+07:00`) }
			: null;
	const antiFakeGpsScore = computeAntiFakeGpsScore({
		accuracy,
		previous: previousPoint,
		current: { lat, lng, atMs: Date.now() }
	});

	const payload = {
		jam_keluar: nowTimeJakarta(),
		foto_pulang: fotoId,
		lat_pulang: lat,
		lng_pulang: lng,
		jarak_pulang_m: jarak,
		pulang_valid: pulangValid,
		face_verify_keluar_id: faceResult.verificationId,
		anti_fake_gps_score: antiFakeGpsScore
	};

	const result = await directusServerJson(`/items/absensi_harian/${existing.id}`, {
		method: 'PATCH',
		body: JSON.stringify(payload)
	});

	return json({
		record: result?.data ?? result,
		pulangValid,
		jarak,
		faceVerified: faceResult.passed,
		antiFakeGpsScore
	});
};
