// src/lib/server/ess/istirahat.ts
// Fase 1 backend Absensi Istirahat (Foto Wajib) — satu tempat untuk semua aturan istirahat,
// dipakai oleh endpoint break-out/break-in + cron auto-close (fase lain), supaya tidak duplikat.
// Lihat implementation_plan_...Absensi Istirahat...md §3.0.1c/§FASE1 untuk rancangan penuh.

import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { hitungOverrunDariTotalMenit, type KonfigurasiDisiplinIstirahat } from '$lib/server/ess/istirahatOverrunEngine';

export interface IstirahatKategori {
	id: string;
	nama: string;
	hitung_kuota: boolean;
	kuota_menit_sendiri: number | null;
	foto_wajib: boolean | null;
	urutan: number;
	aktif: boolean;
}

export interface IstirahatConfig {
	aktif: boolean;
	konfig: KonfigurasiDisiplinIstirahat & {
		istirahat_absen_mandiri_aktif?: boolean;
		istirahat_foto_masuk_wajib?: boolean;
		istirahat_foto_keluar_wajib?: boolean;
		istirahat_geofence_wajib?: boolean;
		istirahat_liveness_wajib?: boolean;
		istirahat_min_durasi_menit?: number;
		istirahat_jendela_toleransi_menit?: number;
		istirahat_auto_close_menit?: number;
		istirahat_blokir_pulang?: boolean;
		istirahat_departments?: string[];
	} | null;
	kategoriAktif: IstirahatKategori[];
}

export interface AbsensiIstirahatLogRow {
	id: string;
	absensi_harian_id: string;
	karyawan_id: string;
	tanggal: string;
	kategori_id: string | null;
	jam_keluar: string | null;
	jam_masuk: string | null;
	foto_keluar: string | null;
	foto_masuk: string | null;
	lat_keluar: number | null;
	lng_keluar: number | null;
	lat_masuk: number | null;
	lng_masuk: number | null;
	jarak_masuk_m: number | null;
	masuk_valid: boolean | null;
	face_verify_masuk_id: string | null;
	durasi_menit: number | null;
	overrun_menit: number | null;
	tier: number | null;
	sumber: string | null;
	auto_close: boolean | null;
	[key: string]: any;
}

const LOG_FIELDS = [
	'id',
	'absensi_harian_id',
	'karyawan_id',
	'tanggal',
	'kategori_id',
	'jam_keluar',
	'jam_masuk',
	'foto_keluar',
	'foto_masuk',
	'lat_keluar',
	'lng_keluar',
	'lat_masuk',
	'lng_masuk',
	'jarak_masuk_m',
	'masuk_valid',
	'face_verify_masuk_id',
	'durasi_menit',
	'overrun_menit',
	'tier',
	'sumber',
	'auto_close'
].join(',');

function parseTimeToMinutes(str: string | null | undefined): number | null {
	if (!str || typeof str !== 'string' || str === '-') return null;
	const parts = str.split(':');
	if (parts.length < 2) return null;
	const h = Number(parts[0]);
	const m = Number(parts[1]);
	if (Number.isNaN(h) || Number.isNaN(m)) return null;
	return h * 60 + m;
}

/** Konfigurasi tahun berjalan + kategori aktif. Sama pola gate seperti disiplin-status: hanya berlaku bila status='aktif'. */
export async function loadIstirahatConfig(): Promise<IstirahatConfig> {
	const tahun = Number(todayJakarta().slice(0, 4));
	const konfigQuery = new URLSearchParams({ sort: '-tahun_berlaku', limit: '-1' });
	const konfigRes = await directusServerJson<{ data: any[] }>(`/items/konfigurasi_kebijakan_disiplin?${konfigQuery.toString()}`);
	const semuaKonfig = konfigRes?.data || [];
	const konfig =
		semuaKonfig.find((c) => Number(c.tahun_berlaku) === tahun) ||
		semuaKonfig.filter((c) => Number(c.tahun_berlaku) < tahun)[0] ||
		semuaKonfig[semuaKonfig.length - 1] ||
		null;

	if (!konfig || konfig.status !== 'aktif' || !konfig.istirahat_absen_mandiri_aktif) {
		return { aktif: false, konfig: konfig || null, kategoriAktif: [] };
	}

	const kategoriQuery = new URLSearchParams({
		'filter[aktif][_eq]': 'true',
		sort: 'urutan',
		fields: 'id,nama,hitung_kuota,kuota_menit_sendiri,foto_wajib,urutan,aktif',
		limit: '-1'
	});
	const kategoriRes = await directusServerJson<{ data: IstirahatKategori[] }>(`/items/istirahat_kategori?${kategoriQuery.toString()}`);

	return { aktif: true, konfig, kategoriAktif: kategoriRes?.data || [] };
}

/** Jendela istirahat shift karyawan (jam_istirahat_mulai/selesai dari jadwal_kerja). */
export async function getJendelaIstirahat(karyawanId: number): Promise<{ mulai: string | null; selesai: string | null }> {
	const karyawanRes = await directusServerJson<{ data: { jadwal_kerja_id: string | null } }>(
		`/items/karyawan/${karyawanId}?fields=jadwal_kerja_id`
	);
	const jadwalId = karyawanRes?.data?.jadwal_kerja_id || null;
	if (!jadwalId) return { mulai: null, selesai: null };

	const jadwalRes = await directusServerJson<{ data: { jam_istirahat_mulai?: string | null; jam_istirahat_selesai?: string | null } }>(
		`/items/jadwal_kerja/${jadwalId}?fields=jam_istirahat_mulai,jam_istirahat_selesai`
	);
	return {
		mulai: jadwalRes?.data?.jam_istirahat_mulai || null,
		selesai: jadwalRes?.data?.jam_istirahat_selesai || null
	};
}

/** Nama kategori untuk pesan guard clock-out ("belum absen kembali dari istirahat (Sholat, ...)"). */
export async function getKategoriNama(kategoriId: string): Promise<string | null> {
	try {
		const res = await directusServerJson<{ data: { nama: string } }>(`/items/istirahat_kategori/${kategoriId}?fields=nama`);
		return res?.data?.nama || null;
	} catch {
		return null;
	}
}

export interface JedaHariIniRow {
	id: string;
	kategoriNama: string | null;
	jam_keluar: string | null;
	jam_masuk: string | null;
	durasi_menit: number | null;
	overrun_menit: number | null;
	tier: number | null;
	foto_masuk: string | null;
}

/** Seluruh jeda hari ini (untuk bottom-sheet detail di kartu beranda ESS Fase 3). */
export async function listJedaHariIni(absensiHarianId: string): Promise<JedaHariIniRow[]> {
	const query = new URLSearchParams({
		'filter[absensi_harian_id][_eq]': absensiHarianId,
		fields: 'id,jam_keluar,jam_masuk,durasi_menit,overrun_menit,tier,foto_masuk,kategori_id.nama',
		sort: 'tanggal_dibuat',
		limit: '-1'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/absensi_istirahat_log?${query.toString()}`);
	return (result?.data || []).map((row) => ({
		id: row.id,
		kategoriNama: row.kategori_id?.nama || null,
		jam_keluar: row.jam_keluar,
		jam_masuk: row.jam_masuk,
		durasi_menit: row.durasi_menit,
		overrun_menit: row.overrun_menit,
		tier: row.tier,
		foto_masuk: row.foto_masuk
	}));
}

/** Baris absensi_istirahat_log hari ini yang jam_masuk masih kosong (maksimal 1 boleh terbuka). */
export async function findJedaTerbuka(absensiHarianId: string): Promise<AbsensiIstirahatLogRow | null> {
	const query = new URLSearchParams({
		'filter[absensi_harian_id][_eq]': absensiHarianId,
		'filter[jam_masuk][_null]': 'true',
		fields: LOG_FIELDS,
		sort: '-tanggal_dibuat',
		limit: '1'
	});
	const result = await directusServerJson<{ data: AbsensiIstirahatLogRow[] }>(`/items/absensi_istirahat_log?${query.toString()}`);
	return result?.data?.[0] || null;
}

export interface ValidateBreakPunchParams {
	jenis: 'break-out' | 'break-in';
	absensiRecord: { jam_masuk?: string | null; jam_keluar?: string | null } | null;
	jedaTerbuka: AbsensiIstirahatLogRow | null;
	jendela: { mulai: string | null; selesai: string | null };
	config: IstirahatConfig['konfig'];
	nowHHmm: string;
	// Fase 2 (rencana v2 §3.2) — toleransi jendela per pola kerja (mis. istirahat_toleransi_bel_
	// mobile_menit). Bila diisi, MENGGANTIKAN istirahat_jendela_toleransi_menit generik untuk
	// panggilan ini saja — orang di jalan tidak bisa dituntut presisi yang sama dengan di kantor.
	toleransiJendelaMenitOverride?: number;
}

function isEmptyTime(v: string | null | undefined): boolean {
	return !v || v === '-';
}

/** Guard bersama break-out/break-in. Mengembalikan pesan error bila ditolak, null bila boleh lanjut. */
export function validateBreakPunch(params: ValidateBreakPunchParams): string | null {
	const { jenis, absensiRecord, jedaTerbuka, jendela, config, nowHHmm } = params;

	if (!absensiRecord || isEmptyTime(absensiRecord.jam_masuk)) {
		return 'Anda belum absen masuk hari ini.';
	}
	if (!isEmptyTime(absensiRecord.jam_keluar)) {
		return 'Anda sudah absen pulang hari ini — tidak bisa mencatat istirahat lagi.';
	}

	if (jenis === 'break-out') {
		if (jedaTerbuka) {
			return 'Anda masih dalam istirahat yang belum ditutup. Absen kembali dulu sebelum mulai istirahat baru.';
		}
	} else {
		if (!jedaTerbuka) {
			return 'Anda belum absen keluar istirahat. Tidak ada jeda yang sedang berjalan.';
		}
		const toleransi = Number(config?.istirahat_min_durasi_menit) || 5;
		const keluarMin = parseTimeToMinutes(jedaTerbuka.jam_keluar);
		let nowMin = parseTimeToMinutes(nowHHmm);
		if (keluarMin != null && nowMin != null) {
			if (nowMin <= keluarMin) nowMin += 1440;
			if (nowMin - keluarMin < toleransi) {
				return `Durasi istirahat terlalu singkat (minimal ${toleransi} menit). Pastikan Anda tidak salah pencet.`;
			}
		}
	}

	// Jendela shift ± toleransi — hanya dicek untuk break-out (mulai istirahat), tidak memblokir
	// break-in (kembali) karena karyawan HARUS bisa menutup jeda kapan pun terlepas dari jendela.
	if (jenis === 'break-out' && jendela.mulai && jendela.selesai) {
		const toleransiJendela = params.toleransiJendelaMenitOverride ?? (Number(config?.istirahat_jendela_toleransi_menit) || 30);
		const mulaiMin = parseTimeToMinutes(jendela.mulai);
		const selesaiMin = parseTimeToMinutes(jendela.selesai);
		const nowMin = parseTimeToMinutes(nowHHmm);
		if (mulaiMin != null && selesaiMin != null && nowMin != null) {
			const batasAwal = mulaiMin - toleransiJendela;
			const batasAkhir = selesaiMin + toleransiJendela;
			if (nowMin < batasAwal || nowMin > batasAkhir) {
				return `Di luar jendela istirahat shift Anda (${jendela.mulai}-${jendela.selesai}, toleransi ${toleransiJendela} menit). Hubungi HRD bila ini keliru.`;
			}
		}
	}

	return null;
}

/**
 * Hitung ulang total menit, overrun, tier, jumlah jeda dari SELURUH baris absensi_istirahat_log
 * hari itu, lalu PATCH rollup ke absensi_harian. Dipanggil setiap kali sebuah jeda ditutup
 * (break-in ESS, cron auto-close, atau koreksi manual HRD).
 */
export async function rollupIstirahat(absensiHarianId: string): Promise<void> {
	const logQuery = new URLSearchParams({
		'filter[absensi_harian_id][_eq]': absensiHarianId,
		fields: `${LOG_FIELDS},kategori_id.hitung_kuota`,
		sort: 'tanggal_dibuat',
		limit: '-1'
	});
	const logRes = await directusServerJson<{ data: any[] }>(`/items/absensi_istirahat_log?${logQuery.toString()}`);
	const rows = logRes?.data || [];

	const konfigQuery = new URLSearchParams({ sort: '-tahun_berlaku', limit: '1' });
	const konfigRes = await directusServerJson<{ data: KonfigurasiDisiplinIstirahat[] }>(
		`/items/konfigurasi_kebijakan_disiplin?${konfigQuery.toString()}`
	);
	const konfig = konfigRes?.data?.[0] || {};

	const closed = rows.filter((r) => !isEmptyTime(r.jam_keluar) && !isEmptyTime(r.jam_masuk));

	let totalMenitHitungKuota = 0;
	let earliestKeluar: string | null = null;
	let latestMasuk: string | null = null;
	let latestFotoKeluar: string | null = null;
	let latestFotoMasuk: string | null = null;
	let latestLat: { keluar: number | null; lng: number | null; masukLat: number | null; masukLng: number | null } = {
		keluar: null,
		lng: null,
		masukLat: null,
		masukLng: null
	};
	let latestJarak: number | null = null;
	let latestValid: boolean | null = null;
	let latestFaceVerifyId: string | null = null;
	let latestSumber: string | null = null;
	let anyAutoClose = false;

	for (const row of closed) {
		const hitungKuota = row.kategori_id?.hitung_kuota !== false;
		if (hitungKuota) {
			const keluarMin = parseTimeToMinutes(row.jam_keluar);
			let masukMin = parseTimeToMinutes(row.jam_masuk);
			if (keluarMin != null && masukMin != null) {
				if (masukMin <= keluarMin) masukMin += 1440;
				totalMenitHitungKuota += masukMin - keluarMin;
			}
			if (earliestKeluar == null || row.jam_keluar < earliestKeluar) earliestKeluar = row.jam_keluar;
		}
		if (latestMasuk == null || row.jam_masuk >= latestMasuk) {
			latestMasuk = row.jam_masuk;
			latestFotoKeluar = row.foto_keluar;
			latestFotoMasuk = row.foto_masuk;
			latestLat = { keluar: row.lat_keluar, lng: row.lng_keluar, masukLat: row.lat_masuk, masukLng: row.lng_masuk };
			latestJarak = row.jarak_masuk_m;
			latestValid = row.masuk_valid;
			latestFaceVerifyId = row.face_verify_masuk_id;
			latestSumber = row.sumber;
		}
		if (row.auto_close) anyAutoClose = true;
	}

	const overrun = hitungOverrunDariTotalMenit(totalMenitHitungKuota, konfig);

	const payload = {
		jam_istirahat_keluar: earliestKeluar || '-',
		jam_istirahat_masuk: latestMasuk || '-',
		foto_istirahat_keluar: latestFotoKeluar,
		foto_istirahat_masuk: latestFotoMasuk,
		lat_istirahat_keluar: latestLat.keluar,
		lng_istirahat_keluar: latestLat.lng,
		lat_istirahat_masuk: latestLat.masukLat,
		lng_istirahat_masuk: latestLat.masukLng,
		jarak_istirahat_masuk_m: latestJarak,
		istirahat_masuk_valid: latestValid,
		face_verify_istirahat_masuk_id: latestFaceVerifyId,
		istirahat_overrun_menit: overrun.menitOverrun,
		istirahat_tier: overrun.tier,
		istirahat_sumber: latestSumber,
		istirahat_auto_close: anyAutoClose,
		istirahat_jumlah_jeda: rows.length
	};

	await directusServerJson(`/items/absensi_harian/${absensiHarianId}`, {
		method: 'PATCH',
		body: JSON.stringify(payload)
	});
}
