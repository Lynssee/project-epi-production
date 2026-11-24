import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { findTodayRecord, getLokasiById, isEmptyTime, listActiveLokasi, nearestLokasi } from '$lib/server/ess/absensi';
import { computeAntiFakeGpsScore, withinRadius } from '$lib/server/ess/geo';
import { nowTimeJakarta, todayJakarta } from '$lib/server/ess/time';
import { verifyFaceInBackground } from '$lib/server/ess/faceVerify';
import { attendanceLockKey, withAttendanceLock } from '$lib/server/ess/attendanceLock';
import { loadIstirahatConfig, findJedaTerbuka, getKategoriNama } from '$lib/server/ess/istirahat';
import { getFieldGateMode } from '$lib/server/gateEnforcement';
import { findActiveCheckin } from '$lib/server/siteCheckin';

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

	const responseBody = await withAttendanceLock(attendanceLockKey('clock_out', karyawan.id, tanggal), async () => {
		const [existing, istirahatConfig, clockoutGateMode, planVsActualGateMode, activeLokasi] = await Promise.all([
			findTodayRecord(karyawan.id, tanggal),
			loadIstirahatConfig(),
			getFieldGateMode('G_ESS_CLOCKOUT_COMPLETE'),
			getFieldGateMode('G_ESS_VISIT_PLAN_VS_ACTUAL'),
			listActiveLokasi()
		]);

		if (!existing || isEmptyTime(existing.jam_masuk)) {
			throw error(409, 'Anda belum absen masuk hari ini.');
		}
		if (!isEmptyTime(existing.jam_keluar)) {
			throw error(409, 'Anda sudah absen pulang hari ini.');
		}

		const needBreakGuard = istirahatConfig.aktif && istirahatConfig.konfig?.istirahat_blokir_pulang !== false;
		const needVisitActiveGuard = clockoutGateMode === 'hard' || clockoutGateMode === 'soft';
		const needVisitPlanGuard = planVsActualGateMode === 'hard' || planVsActualGateMode === 'soft';

		const targetLokasiId = lokasiAbsensiId || existing.lokasi_absensi_id || null;
		const cachedLokasi = targetLokasiId
			? activeLokasi.find((l) => String(l.id) === String(targetLokasiId)) || null
			: null;

		const todayPlansQuery = needVisitPlanGuard
			? new URLSearchParams({
					'filter[karyawan_id][_eq]': String(karyawan.id),
					'filter[tanggal_rencana][_eq]': tanggal,
					'filter[is_planned][_eq]': 'true',
					'filter[plan_status][_eq]': 'planned',
					fields: 'id,nama_lokasi,planned_start_time,planned_end_time,alasan_deviasi',
					limit: '-1'
				})
			: null;

		const [jedaTerbuka, activeVisit, todayPlansRes, fallbackLokasi] = await Promise.all([
			needBreakGuard ? findJedaTerbuka(existing.id) : Promise.resolve(null),
			needVisitActiveGuard ? findActiveCheckin(String(karyawan.id)) : Promise.resolve(null),
			todayPlansQuery
				? directusServerJson<{ data: any[] }>(`/items/site_checkin?${todayPlansQuery.toString()}`).catch(() => null)
				: Promise.resolve(null),
			!cachedLokasi && targetLokasiId ? getLokasiById(targetLokasiId) : Promise.resolve(null)
		]);

		// Keputusan #2 (Absensi Istirahat Foto Wajib): absen pulang diblokir bila istirahat belum
		// ditutup, dikendalikan istirahat_blokir_pulang (default true).
		if (jedaTerbuka) {
			const kategoriNama = jedaTerbuka.kategori_id
				? istirahatConfig.kategoriAktif.find((k) => String(k.id) === String(jedaTerbuka.kategori_id))?.nama ||
					(await getKategoriNama(jedaTerbuka.kategori_id))
				: null;
			const detail = kategoriNama ? ` (${kategoriNama}, sejak ${jedaTerbuka.jam_keluar})` : ` (sejak ${jedaTerbuka.jam_keluar})`;
			throw error(409, `Anda belum absen kembali dari istirahat${detail}. Absen kembali dulu sebelum absen pulang.`);
		}

		// Gate G_ESS_CLOCKOUT_COMPLETE: Karyawan dilarang clock-out jika masih memiliki kunjungan lapangan aktif (belum checkout)
		if (activeVisit) {
			const namaSite = activeVisit.nama_lokasi || 'Kunjungan Lapangan';
			throw error(
				409,
				`[Gate G_ESS_CLOCKOUT_COMPLETE] Anda masih memiliki kunjungan aktif di "${namaSite}". Silakan selesaikan Check-Out kunjungan terlebih dahulu sebelum Absen Pulang.`
			);
		}

		// Gate G_ESS_VISIT_PLAN_VS_ACTUAL: Validasi apakah semua rencana kunjungan hari ini sudah terealisasi atau memiliki alasan deviasi
		if (needVisitPlanGuard) {
			const pendingPlans = (todayPlansRes?.data || []).filter((p) => !p.alasan_deviasi || p.alasan_deviasi.trim() === '');
			if (pendingPlans.length > 0) {
				const daftarPlan = pendingPlans.map((p) => `• ${p.nama_lokasi} (${p.planned_start_time || '-'}-${p.planned_end_time || '-'})`).join('\n');
				throw error(
					409,
					`[Gate G_ESS_VISIT_PLAN_VS_ACTUAL] Anda memiliki ${pendingPlans.length} rencana kunjungan hari ini yang belum terealisasi:\n${daftarPlan}\nHarap beri alasan deviasi/batalkan jadwal di menu Site Check-in sebelum Absen Pulang.`
				);
			}
		}

		const lokasi = cachedLokasi || fallbackLokasi || nearestLokasi(lat, lng, activeLokasi);
		if (!lokasi) {
			throw error(400, 'Belum ada titik lokasi absensi yang dikonfigurasi. Hubungi HRD.');
		}

		const { valid: pulangValid, jarak } = withinRadius(lat, lng, lokasi.lat, lokasi.lng, lokasi.radius_m);

		// Upload 1x saja ke Directus /files; fotoId dipakai ulang untuk face verify bila nanti aktif.
		const uploadForm = new FormData();
		uploadForm.append('file', foto, `absen-pulang-${karyawan.id}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto ke server.');
		const uploaded = await uploadRes.json();
		const fotoId = uploaded?.data?.id;
		if (!fotoId) throw error(502, 'Gagal mengunggah foto ke server.');

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
			face_verify_keluar_id: null,
			anti_fake_gps_score: antiFakeGpsScore
		};

		const result = await directusServerJson(`/items/absensi_harian/${existing.id}`, {
			method: 'PATCH',
			body: JSON.stringify(payload)
		});

		// Face recognition (Opsi B): skip total bila belum ada enrollment; bila aktif kelak,
		// jalankan non-blocking memakai ulang fotoId (0 upload ganda).
		verifyFaceInBackground(
			{
				karyawanId: karyawan.id,
				foto,
				context: 'clock_out',
				livenessPassed,
				ipAddress,
				deviceInfo,
				lokasiAbsensiId: lokasi.id,
				existingFotoId: fotoId,
				lokasiThreshold: lokasi.face_match_threshold ?? null,
				skipWhenUnenrolled: true
			},
			async (verificationId) => {
				await directusServerJson(`/items/absensi_harian/${existing.id}`, {
					method: 'PATCH',
					body: JSON.stringify({ face_verify_keluar_id: verificationId })
				});
			}
		);

		return {
			record: result?.data ?? result,
			pulangValid,
			jarak,
			faceVerified: false,
			antiFakeGpsScore
		};
	});

	return json(responseBody);
};
