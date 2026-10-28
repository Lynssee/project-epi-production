// src/routes/api/ess/attendance/break-out/+server.ts
// Fase 1 Absensi Istirahat (Foto Wajib) — mulai istirahat. Foto opsional (tergantung
// istirahat_foto_keluar_wajib / kategori.foto_wajib), GPS wajib. Meniru struktur clock-in
// (authenticateEss -> validasi -> directusServerUpload -> PATCH), tapi menulis ke
// absensi_istirahat_log (koleksi anak), bukan absensi_harian langsung — rollup dipanggil
// oleh break-in saat jeda ditutup.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { findTodayRecord } from '$lib/server/ess/absensi';
import { nowTimeJakarta, todayJakarta } from '$lib/server/ess/time';
import { loadIstirahatConfig, getJendelaIstirahat, findJedaTerbuka, validateBreakPunch } from '$lib/server/ess/istirahat';
import { resolveKaryawanPolaKerja } from '$lib/server/ess/polaKerjaResolver';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const { aktif, konfig, kategoriAktif } = await loadIstirahatConfig();
	if (!aktif) {
		throw error(403, 'Fitur absen istirahat mandiri belum diaktifkan untuk akun Anda. Hubungi HRD.');
	}
	if (Array.isArray(konfig?.istirahat_departments) && konfig!.istirahat_departments!.length > 0) {
		const dept = (karyawan as any)?.departemen || (karyawan as any)?.department || null;
		if (dept && !konfig!.istirahat_departments!.includes(dept)) {
			throw error(403, 'Fitur absen istirahat mandiri belum diaktifkan untuk department Anda.');
		}
	}

	const form = await event.request.formData();
	const kategoriId = form.get('kategori_id')?.toString() || null;
	const lat = Number(form.get('lat'));
	const lng = Number(form.get('lng'));
	const foto = form.get('foto');
	// Fase 2 (rencana v2 §3.2) — mode "istirahat di perjalanan": karyawan mobile boleh mulai
	// istirahat dengan satu titik GPS TANPA foto; foto ditunda sampai tiba (keselamatan
	// berkendara), ditandai foto_ditunda=true. HANYA berlaku utk pola kerja mobile.
	const perjalanan = form.get('perjalanan') === 'true' || form.get('perjalanan') === '1';

	if (!kategoriId || !kategoriAktif.some((k) => k.id === kategoriId)) {
		throw error(400, 'Kategori istirahat wajib dipilih.');
	}
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		throw error(400, 'Lokasi GPS tidak valid. Aktifkan izin lokasi dan coba lagi.');
	}

	const polaKerja = await resolveKaryawanPolaKerja(karyawan.id);
	const izinTundaFoto = perjalanan && polaKerja === 'mobile';

	const kategori = kategoriAktif.find((k) => k.id === kategoriId)!;
	const fotoWajib = kategori.foto_wajib ?? konfig?.istirahat_foto_keluar_wajib ?? false;
	if (fotoWajib && (!(foto instanceof File) || foto.size === 0) && !izinTundaFoto) {
		throw error(400, 'Foto wajib diambil untuk kategori istirahat ini.');
	}

	const tanggal = todayJakarta();
	const absensiRecord = await findTodayRecord(karyawan.id, tanggal);
	if (!absensiRecord) {
		throw error(403, 'Anda belum absen masuk hari ini.');
	}

	const [jedaTerbuka, jendela] = await Promise.all([findJedaTerbuka(absensiRecord.id), getJendelaIstirahat(karyawan.id)]);
	const rejectMsg = validateBreakPunch({
		jenis: 'break-out',
		absensiRecord,
		jedaTerbuka,
		jendela,
		config: konfig,
		nowHHmm: nowTimeJakarta(),
		toleransiJendelaMenitOverride: polaKerja === 'mobile' ? Number(konfig?.istirahat_toleransi_bel_mobile_menit) || undefined : undefined
	});
	if (rejectMsg) throw error(409, rejectMsg);

	let fotoId: string | null = null;
	if (foto instanceof File && foto.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', foto, `istirahat-keluar-${karyawan.id}-${Date.now()}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, 'Gagal mengunggah foto ke server.');
		const uploaded = await uploadRes.json();
		fotoId = uploaded?.data?.id || null;
	}

	// Catatan sengaja hemat (lihat implementation_plan §3.0.1): GPS punch keluar-istirahat
	// disimpan tapi tanpa field jarak/valid terpisah — verifikasi geofence ditegakkan di
	// punch kembali (break-in), yang berdampak ke jam kerja & sanksi.

	const result = await directusServerJson<{ data: { id: string } }>('/items/absensi_istirahat_log', {
		method: 'POST',
		body: JSON.stringify({
			absensi_harian_id: absensiRecord.id,
			karyawan_id: String(karyawan.id),
			tanggal,
			kategori_id: kategoriId,
			jam_keluar: nowTimeJakarta(),
			foto_keluar: fotoId,
			lat_keluar: lat,
			lng_keluar: lng,
			sumber: 'ESS',
			foto_ditunda: izinTundaFoto && !fotoId
		})
	});

	return json({ log: result?.data ?? result, kategori: { id: kategori.id, nama: kategori.nama, hitungKuota: kategori.hitung_kuota } });
};
