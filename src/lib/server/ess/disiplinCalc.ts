// src/lib/server/ess/disiplinCalc.ts
// Fase 3 ESS — Status Kehadiran & Denda Real-time (Kebijakan Kedisiplinan Karyawan,
// ref Memo 001/MEMO/HRD/I/2026). Duplikasi KECIL & DISENGAJA dari fungsi murni
// hitungDendaKeterlambatanBulanan() di erp-epi-1/src/lib/services/disiplinPayrollEngine.js —
// kedua app terpisah (repo & deploy sendiri-sendiri), tidak ada package bersama antara
// ERP Admin dan ESS lapangan, jadi duplikasi kecil ini lebih aman daripada import lintas-repo.
// Kalau rumus di erp-epi-1 berubah, pastikan disamakan di sini juga.

export interface KonfigurasiDisiplin {
	status: string;
	toleransi_keterlambatan_menit?: number;
	tarif_denda_keterlambatan_per_jam?: number;
	metode_pembulatan_denda?: string;
	ambang_teguran_lisan_per_bulan?: number;
	ambang_teguran_tertulis_per_bulan?: number;
	ambang_sp_per_bulan?: number;
	toleransi_izin_kali_per_bulan?: number;
	jam_kerja_mulai?: string;
	[key: string]: any;
}

export interface JadwalKerja {
	jam_masuk_normal?: string | null;
	toleransi_telat_menit?: number | null;
}

export interface AbsensiRecord {
	tanggal: string;
	status: string;
	jam_masuk: string | null;
}

function parseTimeToMinutes(str: string | null | undefined): number | null {
	if (!str || typeof str !== 'string') return null;
	const parts = str.split(':');
	if (parts.length < 2) return null;
	const h = Number(parts[0]);
	const m = Number(parts[1]);
	if (Number.isNaN(h) || Number.isNaN(m)) return null;
	return h * 60 + m;
}

const IZIN_STATUSES = new Set(['IZIN', 'IZIN 1/2 HARI', 'IZIN TERLAMBAT', 'IZIN DATANG TERLAMBAT', 'IZIN PULANG CEPAT']);

export interface TelatItem {
	tanggal: string;
	jamMasuk: string;
	menitTelat: number;
	estimasiDenda: number;
}

export interface IzinItem {
	tanggal: string;
	status: string;
	jamMasuk: string | null;
}

export interface StatusKehadiranBulanIni {
	hariTerlambat: number;
	estimasiDendaTerlambat: number;
	maxMenitTelat: number;
	izinTerpakaiBulanIni: number;
	sisaToleransiIzin: number;
	toleransiIzinQuota: number;
	ambang: { teguranLisan: number; teguranTertulis: number; sp: number };
	posisiSaatIni: 'aman' | 'mendekati_teguran_lisan' | 'mendekati_teguran_tertulis' | 'mendekati_sp';
	rincianTelat: TelatItem[];
	rincianIzin: IzinItem[];
	jamMasukNormalFormatted: string;
	toleransiMenit: number;
	tarifPerJam: number;
	metodePembulatan: string;
	totalHariKerjaTercatat: number;
	totalTepatWaktu: number;
}

function formatMinutesToTime(totalMinutes: number): string {
	const h = Math.floor(totalMinutes / 60);
	const m = totalMinutes % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function hitungStatusKehadiranBulanIni(
	absensiList: AbsensiRecord[],
	jadwalKerja: JadwalKerja | null,
	konfig: KonfigurasiDisiplin
): StatusKehadiranBulanIni {
	const jamMasukNormalMinutes =
		parseTimeToMinutes(jadwalKerja?.jam_masuk_normal) ?? parseTimeToMinutes(konfig.jam_kerja_mulai) ?? 8 * 60;
	const toleransi =
		(jadwalKerja?.toleransi_telat_menit != null ? Number(jadwalKerja.toleransi_telat_menit) : null) ??
		Number(konfig.toleransi_keterlambatan_menit ?? 5);
	const tarifPerJam = Number(konfig.tarif_denda_keterlambatan_per_jam) || 0;
	const metode = konfig.metode_pembulatan_denda || 'ceil_per_jam';

	let hariTerlambat = 0;
	let estimasiDenda = 0;
	let maxMenitTelat = 0;
	let izinTerpakai = 0;
	let totalTepatWaktu = 0;
	let totalHariKerjaTercatat = 0;

	const rincianTelat: TelatItem[] = [];
	const rincianIzin: IzinItem[] = [];

	// Urutkan absensi berdasarkan tanggal ascending
	const sortedAbsensi = [...absensiList].sort((a, b) => (a.tanggal || '').localeCompare(b.tanggal || ''));

	for (const rec of sortedAbsensi) {
		const status = String(rec.status || '').toUpperCase();
		if (IZIN_STATUSES.has(status)) {
			izinTerpakai++;
			rincianIzin.push({
				tanggal: rec.tanggal,
				status: rec.status,
				jamMasuk: rec.jam_masuk || null
			});
			continue;
		}
		const masuk = parseTimeToMinutes(rec.jam_masuk);
		if (masuk == null) continue;
		totalHariKerjaTercatat++;

		const batas = jamMasukNormalMinutes + toleransi;
		if (masuk <= batas) {
			totalTepatWaktu++;
			continue;
		}

		const menitTelat = masuk - batas;
		hariTerlambat++;
		maxMenitTelat = Math.max(maxMenitTelat, menitTelat);
		const jamTelat = metode === 'prorata_menit' ? menitTelat / 60 : Math.ceil(menitTelat / 60);
		const dendaHariIni = Math.round(jamTelat * tarifPerJam);
		estimasiDenda += dendaHariIni;

		rincianTelat.push({
			tanggal: rec.tanggal,
			jamMasuk: rec.jam_masuk || '-',
			menitTelat,
			estimasiDenda: dendaHariIni
		});
	}

	const ambangLisan = Number(konfig.ambang_teguran_lisan_per_bulan) || 3;
	const ambangTertulis = Number(konfig.ambang_teguran_tertulis_per_bulan) || 5;
	const ambangSp = Number(konfig.ambang_sp_per_bulan) || 8;
	const toleransiIzinKali = Number(konfig.toleransi_izin_kali_per_bulan) || 1;

	let posisi: StatusKehadiranBulanIni['posisiSaatIni'] = 'aman';
	if (hariTerlambat >= ambangSp - 1) posisi = 'mendekati_sp';
	else if (hariTerlambat >= ambangTertulis - 1) posisi = 'mendekati_teguran_tertulis';
	else if (hariTerlambat >= ambangLisan - 1) posisi = 'mendekati_teguran_lisan';

	return {
		hariTerlambat,
		estimasiDendaTerlambat: estimasiDenda,
		maxMenitTelat,
		izinTerpakaiBulanIni: izinTerpakai,
		sisaToleransiIzin: Math.max(0, toleransiIzinKali - izinTerpakai),
		toleransiIzinQuota: toleransiIzinKali,
		ambang: { teguranLisan: ambangLisan, teguranTertulis: ambangTertulis, sp: ambangSp },
		posisiSaatIni: posisi,
		rincianTelat,
		rincianIzin,
		jamMasukNormalFormatted: formatMinutesToTime(jamMasukNormalMinutes),
		toleransiMenit: toleransi,
		tarifPerJam,
		metodePembulatan: metode,
		totalHariKerjaTercatat,
		totalTepatWaktu
	};
}

export interface RincianAbsensi {
	telat: { tanggal: string; menitTelat: number }[];
	alpa: string[];
}

/**
 * Fase 3 ESS — Transparansi Slip Gaji: daftar TANGGAL yang menyebabkan potongan_terlambat/
 * potongan_alpa pada payroll_bulanan, supaya karyawan bisa menelusuri sumbernya (bukan cuma
 * angka lump-sum). Informasional saja — total Rupiah tetap dari payroll_bulanan (sumber sah),
 * bukan dihitung ulang di sini.
 */
export function listRincianAbsensi(absensiList: AbsensiRecord[], jadwalKerja: JadwalKerja | null, konfig: KonfigurasiDisiplin): RincianAbsensi {
	const jamMasukNormal =
		parseTimeToMinutes(jadwalKerja?.jam_masuk_normal) ?? parseTimeToMinutes(konfig.jam_kerja_mulai) ?? 8 * 60;
	const toleransi =
		(jadwalKerja?.toleransi_telat_menit != null ? Number(jadwalKerja.toleransi_telat_menit) : null) ??
		Number(konfig.toleransi_keterlambatan_menit ?? 5);

	const telat: { tanggal: string; menitTelat: number }[] = [];
	const alpa: string[] = [];

	for (const rec of absensiList) {
		const status = String(rec.status || '').toUpperCase();
		if (status === 'ALPA') {
			alpa.push(rec.tanggal);
			continue;
		}
		const masuk = parseTimeToMinutes(rec.jam_masuk);
		if (masuk == null) continue;
		const batas = jamMasukNormal + toleransi;
		if (masuk > batas) telat.push({ tanggal: rec.tanggal, menitTelat: masuk - batas });
	}

	return { telat, alpa };
}
