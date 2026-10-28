// @ts-nocheck
// src/lib/utils/absensiDurasi.js
// ESS/Absensi — Lapisan normalisasi durasi (Fase 1).
// Modul JS murni ber-JSDoc; dipakai identik di erp-epi & project-epi. project-epi memakai
// tsconfig strict (checkJs + noImplicitAny) sehingga @ts-nocheck dipertahankan agar 1 file
// tetap byte-identical di kedua repo. Logika diverifikasi 46 unit test di erp-epi.
//
// TUJUAN: menyediakan satu sumber logika untuk durasi absensi (Full Day / Half Day / Hourly)
// tanpa merombak kolom `absensi_harian.status` yang masih jadi sumber kebenaran dan dipakai
// belasan konsumen (disiplinPayrollEngine, kpiEngineConfig, gamifikasi, payrollSlipPdf, dst).
//
// Modul ini SENGAJA framework-agnostic (tanpa import SvelteKit/$lib) supaya bisa dipakai ulang
// di dashboard lapangan (project-epi) lewat import relatif / salinan sinkron.
//
// Alur pemakaian:
//   UI  ->  { statusUtama, tipeDurasi, sesi, jamMulai, jamSelesai }  (input manusia)
//   simpan ->  susunPayloadDurasi(...)  ->  { status (legacy), tipe_durasi, sesi,
//                jam_mulai_izin, jam_selesai_izin, total_durasi_jam, potongan_hari }
//   rekap ->  formatBadgeAbsensi(record)  ->  "CUTI (1/2 Hari - Pagi)"

/** Status utama kanonik (6). Dipakai UI sebagai chip; BUKAN yang disimpan ke kolom `status`. */
export const STATUS_UTAMA = Object.freeze({
	HADIR: 'HADIR',
	CUTI: 'CUTI',
	IZIN: 'IZIN',
	SAKIT: 'SAKIT',
	DINAS_LUAR: 'DINAS_LUAR',
	ALPA: 'ALPA'
});

/** Tipe durasi. */
export const TIPE_DURASI = Object.freeze({
	FULL_DAY: 'FULL_DAY',
	HALF_DAY: 'HALF_DAY',
	HOURLY: 'HOURLY'
});

/** Sesi untuk Half Day. */
export const SESI = Object.freeze({
	PAGI: 'PAGI',
	SIANG: 'SIANG'
});

/**
 * Jam default tiap sesi. BUKAN hardcode final — dipakai sebagai fallback; Fase 3 akan
 * menyuntik jam sesi dari master shift/jadwal karyawan lewat parameter `konfigSesi`.
 */
export const DEFAULT_SESI_JAM = Object.freeze({
	PAGI: Object.freeze({ mulai: '08:00', selesai: '12:00' }),
	SIANG: Object.freeze({ mulai: '13:00', selesai: '17:00' })
});

/** Jam kerja standar 1 HK (untuk konversi Hourly -> proporsi hari bila diperlukan). */
export const JAM_KERJA_STANDAR = 8;

/** Tipe durasi yang valid untuk tiap status utama. */
export const TIPE_DURASI_DIIZINKAN = Object.freeze({
	HADIR: [TIPE_DURASI.FULL_DAY],
	CUTI: [TIPE_DURASI.FULL_DAY, TIPE_DURASI.HALF_DAY],
	IZIN: [TIPE_DURASI.FULL_DAY, TIPE_DURASI.HALF_DAY, TIPE_DURASI.HOURLY],
	SAKIT: [TIPE_DURASI.FULL_DAY, TIPE_DURASI.HALF_DAY],
	DINAS_LUAR: [TIPE_DURASI.FULL_DAY, TIPE_DURASI.HALF_DAY, TIPE_DURASI.HOURLY],
	ALPA: [TIPE_DURASI.FULL_DAY]
});

// ==================== UTILITAS JAM ====================

/** '08:30' -> 510. Menerima 'HH:mm' atau 'HH:mm:ss'. Selain itu -> null. */
export function menitDariJam(hhmm) {
	if (typeof hhmm !== 'string') return null;
	const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
	if (!m) return null;
	const jam = Number(m[1]);
	const menit = Number(m[2]);
	if (jam < 0 || jam > 23 || menit < 0 || menit > 59) return null;
	return jam * 60 + menit;
}

/** 510 -> '08:30'. */
export function jamDariMenit(totalMenit) {
	if (!Number.isFinite(totalMenit)) return null;
	const norm = ((Math.round(totalMenit) % 1440) + 1440) % 1440;
	const jam = Math.floor(norm / 60);
	const menit = norm % 60;
	return `${String(jam).padStart(2, '0')}:${String(menit).padStart(2, '0')}`;
}

function bulatkan(n, desimal = 2) {
	const f = 10 ** desimal;
	return Math.round((n + Number.EPSILON) * f) / f;
}

/**
 * Selisih jam desimal antara mulai & selesai.
 * @param {string} jamMulai 'HH:mm'
 * @param {string} jamSelesai 'HH:mm'
 * @param {{ lintasHari?: boolean }} [opt] lintasHari=true: bila selesai <= mulai, anggap lewat tengah malam (+24 jam). Default false.
 * @returns {number|null} jam desimal 2 angka di belakang koma, atau null bila input tidak valid / rentang non-positif tanpa lintasHari.
 */
export function hitungDurasiJam(jamMulai, jamSelesai, opt = {}) {
	const a = menitDariJam(jamMulai);
	const b = menitDariJam(jamSelesai);
	if (a === null || b === null) return null;
	let diff = b - a;
	if (diff <= 0) {
		if (opt.lintasHari) diff += 1440;
		else return null;
	}
	return bulatkan(diff / 60, 2);
}

/**
 * Validasi rentang jam untuk Hourly.
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validasiRentangJam(jamMulai, jamSelesai, opt = {}) {
	if (!jamMulai || !jamSelesai) {
		return { valid: false, error: 'Jam mulai dan jam selesai wajib diisi.' };
	}
	const a = menitDariJam(jamMulai);
	const b = menitDariJam(jamSelesai);
	if (a === null) return { valid: false, error: `Format jam mulai tidak valid: "${jamMulai}" (harus HH:mm).` };
	if (b === null) return { valid: false, error: `Format jam selesai tidak valid: "${jamSelesai}" (harus HH:mm).` };
	if (b <= a && !opt.lintasHari) {
		return { valid: false, error: 'Jam selesai harus lebih besar dari jam mulai.' };
	}
	return { valid: true, error: null };
}

/**
 * Ambil pasangan jam untuk sesi Half Day.
 * @param {'PAGI'|'SIANG'} sesi
 * @param {Record<string,{mulai:string,selesai:string}>} [konfigSesi] override (mis. dari master shift)
 */
export function jamUntukSesi(sesi, konfigSesi = DEFAULT_SESI_JAM) {
	if (!sesi) return null;
	const key = String(sesi).toUpperCase();
	return konfigSesi[key] || DEFAULT_SESI_JAM[key] || null;
}

// ==================== JEMBATAN STATUS LEGACY <-> KANONIK ====================

/**
 * Petakan string status legacy (nilai kolom `absensi_harian.status`) ke status utama kanonik.
 * Nilai kehadiran (HADIR, TERLAMBAT, SHIFT SIANG/MALAM, Stand-by), LIBUR, dan BELUM ABSEN -> HADIR/null sesuai konteks.
 * @param {string} statusLegacy
 * @returns {string|null} salah satu STATUS_UTAMA, atau null bila bukan kategori absen berdurasi.
 */
export function normalizeStatusUtama(statusLegacy) {
	const s = String(statusLegacy || '').trim().toUpperCase();
	if (!s) return null;
	if (s.startsWith('CUTI')) return STATUS_UTAMA.CUTI;
	if (s.startsWith('SAKIT')) return STATUS_UTAMA.SAKIT;
	if (s.startsWith('IZIN')) return STATUS_UTAMA.IZIN;
	if (s === 'ALPA' || s === 'ALPHA' || s === 'MANGKIR') return STATUS_UTAMA.ALPA;
	if (s === 'DINAS LUAR' || s === 'DINAS_LUAR' || s === 'TUGAS' || s === 'DINAS') return STATUS_UTAMA.DINAS_LUAR;
	if (
		s === 'HADIR' || s === 'TERLAMBAT' || s === 'SHIFT SIANG' || s === 'SHIFT MALAM' ||
		s === 'STAND-BY' || s === 'STANDBY'
	) {
		return STATUS_UTAMA.HADIR;
	}
	return null; // BELUM ABSEN, LIBUR, dll
}

/**
 * Turunkan tipe durasi dari string status legacy (+ kolom pendukung bila ada).
 * @param {string} statusLegacy
 * @param {{ durasi_izin_jam?: number, total_durasi_jam?: number }} [record]
 * @returns {'FULL_DAY'|'HALF_DAY'|'HOURLY'}
 */
export function deriveTipeDurasi(statusLegacy, record = {}) {
	const s = String(statusLegacy || '').trim().toUpperCase();
	if (s === 'IZIN JAM' || s === 'IZIN_JAM') return TIPE_DURASI.HOURLY;
	if (s.includes('1/2 HARI') || s.includes('SETENGAH HARI') || s.includes('HALF')) return TIPE_DURASI.HALF_DAY;
	const jam = Number(record.total_durasi_jam ?? record.durasi_izin_jam);
	if (Number.isFinite(jam) && jam > 0 && (s.startsWith('IZIN') || s === 'DINAS LUAR' || s === 'TUGAS')) {
		return TIPE_DURASI.HOURLY;
	}
	return TIPE_DURASI.FULL_DAY;
}

/**
 * Susun kembali string status legacy dari (statusUtama kanonik + tipeDurasi).
 * Half-day SAKIT & DINAS tidak punya string legacy khusus — info durasinya hidup di kolom
 * `tipe_durasi`/`potongan_hari`, string `status` tetap 'SAKIT' / 'DINAS LUAR'.
 * @param {string} statusUtama STATUS_UTAMA.*
 * @param {string} tipeDurasi TIPE_DURASI.*
 * @returns {string} nilai untuk kolom `absensi_harian.status`
 */
export function susunStatusLegacy(statusUtama, tipeDurasi) {
	const u = String(statusUtama || '').toUpperCase();
	let t = String(tipeDurasi || TIPE_DURASI.FULL_DAY).toUpperCase();
	const diizinkan = TIPE_DURASI_DIIZINKAN[u] || [TIPE_DURASI.FULL_DAY];
	if (!diizinkan.includes(t)) t = diizinkan[0]; // clamp ke tipe pertama yang sah

	switch (u) {
		case STATUS_UTAMA.HADIR:
			return 'HADIR';
		case STATUS_UTAMA.ALPA:
			return 'ALPA';
		case STATUS_UTAMA.CUTI:
			return t === TIPE_DURASI.HALF_DAY ? 'CUTI 1/2 HARI' : 'CUTI';
		case STATUS_UTAMA.IZIN:
			if (t === TIPE_DURASI.HOURLY) return 'IZIN JAM';
			if (t === TIPE_DURASI.HALF_DAY) return 'IZIN 1/2 HARI';
			return 'IZIN';
		case STATUS_UTAMA.SAKIT:
			return 'SAKIT';
		case STATUS_UTAMA.DINAS_LUAR:
			return 'DINAS LUAR';
		default:
			return u || 'HADIR';
	}
}

// ==================== PERHITUNGAN POTONGAN ====================

/**
 * Potongan hari kerja (payroll) untuk satu baris absensi.
 * Konvensi (mengikuti dok payload): HOURLY -> 0 (per-jam ditangani terpisah lewat total_durasi_jam).
 * @returns {number} 1 | 0.5 | 0
 */
export function hitungPotonganHari({ statusUtama, tipeDurasi }) {
	const u = String(statusUtama || '').toUpperCase();
	const t = String(tipeDurasi || TIPE_DURASI.FULL_DAY).toUpperCase();
	if (u === STATUS_UTAMA.HADIR) return 0;
	if (u === STATUS_UTAMA.ALPA) return 1;
	// CUTI / IZIN / SAKIT / DINAS_LUAR
	if (t === TIPE_DURASI.HOURLY) return 0;
	if (t === TIPE_DURASI.HALF_DAY) return 0.5;
	return 1;
}

/**
 * Potongan saldo cuti (hanya relevan saat statusUtama = CUTI).
 * @returns {number} 1 | 0.5 | 0
 */
export function hitungPotonganSaldoCuti({ tipeDurasi }) {
	const t = String(tipeDurasi || TIPE_DURASI.FULL_DAY).toUpperCase();
	if (t === TIPE_DURASI.HALF_DAY) return 0.5;
	if (t === TIPE_DURASI.HOURLY) return 0;
	return 1;
}

/** Konversi jam desimal -> proporsi hari kerja (untuk laporan; payroll boleh pakai/abaikan). */
export function jamKeProporsiHari(totalDurasiJam, jamKerjaStandar = JAM_KERJA_STANDAR) {
	const jam = Number(totalDurasiJam);
	if (!Number.isFinite(jam) || jam <= 0) return 0;
	return bulatkan(jam / jamKerjaStandar, 2);
}

// ==================== SUSUN PAYLOAD ====================

/**
 * @typedef {Object} InputDurasi
 * @property {string} statusUtama  STATUS_UTAMA.* (HADIR/CUTI/IZIN/SAKIT/DINAS_LUAR/ALPA)
 * @property {string} [tipeDurasi] TIPE_DURASI.* — default FULL_DAY (di-clamp ke yang sah untuk status)
 * @property {'PAGI'|'SIANG'|null} [sesi] wajib bila HALF_DAY
 * @property {string} [jamMulai]   'HH:mm' — wajib bila HOURLY
 * @property {string} [jamSelesai] 'HH:mm' — wajib bila HOURLY
 * @property {Record<string,{mulai:string,selesai:string}>} [konfigSesi]
 * @property {boolean} [lintasHari] izinkan HOURLY melewati tengah malam
 */

/**
 * Validasi input durasi. Kembalikan daftar error (kosong = valid).
 * @param {InputDurasi} input
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validasiInputDurasi(input) {
	const errors = [];
	const u = String(input?.statusUtama || '').toUpperCase();
	if (!Object.values(STATUS_UTAMA).includes(u)) {
		errors.push(`Status utama tidak dikenali: "${input?.statusUtama}".`);
		return { valid: false, errors };
	}
	const diizinkan = TIPE_DURASI_DIIZINKAN[u];
	const t = String(input?.tipeDurasi || TIPE_DURASI.FULL_DAY).toUpperCase();
	if (!diizinkan.includes(t)) {
		errors.push(`Tipe durasi "${t}" tidak berlaku untuk status ${u}. Pilihan: ${diizinkan.join(', ')}.`);
	}
	if (t === TIPE_DURASI.HALF_DAY) {
		const sesi = String(input?.sesi || '').toUpperCase();
		if (sesi !== SESI.PAGI && sesi !== SESI.SIANG) {
			errors.push('Sesi (Pagi/Siang) wajib dipilih untuk durasi 1/2 hari.');
		}
	}
	if (t === TIPE_DURASI.HOURLY) {
		const v = validasiRentangJam(input?.jamMulai, input?.jamSelesai, { lintasHari: !!input?.lintasHari });
		if (!v.valid) errors.push(v.error);
	}
	return { valid: errors.length === 0, errors };
}

/**
 * Susun payload siap-simpan ke koleksi `absensi_harian`.
 * TIDAK melempar — bila input HOURLY tak valid, `total_durasi_jam` = null dan pemanggil
 * sebaiknya sudah menahan submit lewat validasiInputDurasi().
 *
 * @param {InputDurasi} input
 * @returns {{
 *   status: string,
 *   tipe_durasi: string,
 *   sesi: string|null,
 *   jam_mulai_izin: string|null,
 *   jam_selesai_izin: string|null,
 *   total_durasi_jam: number|null,
 *   potongan_hari: number,
 *   durasi_izin_jam: number
 * }}
 */
export function susunPayloadDurasi(input) {
	const u = String(input?.statusUtama || '').toUpperCase();
	const diizinkan = TIPE_DURASI_DIIZINKAN[u] || [TIPE_DURASI.FULL_DAY];
	let tipe = String(input?.tipeDurasi || TIPE_DURASI.FULL_DAY).toUpperCase();
	if (!diizinkan.includes(tipe)) tipe = diizinkan[0];

	let sesi = null;
	let jamMulai = null;
	let jamSelesai = null;
	let totalJam = null;

	if (tipe === TIPE_DURASI.HALF_DAY) {
		const s = String(input?.sesi || '').toUpperCase();
		sesi = s === SESI.PAGI || s === SESI.SIANG ? s : null;
		const rentang = jamUntukSesi(sesi, input?.konfigSesi);
		if (rentang) {
			jamMulai = rentang.mulai;
			jamSelesai = rentang.selesai;
			totalJam = hitungDurasiJam(rentang.mulai, rentang.selesai);
		}
	} else if (tipe === TIPE_DURASI.HOURLY) {
		jamMulai = input?.jamMulai || null;
		jamSelesai = input?.jamSelesai || null;
		totalJam = hitungDurasiJam(jamMulai, jamSelesai, { lintasHari: !!input?.lintasHari });
	}

	const potonganHari = hitungPotonganHari({ statusUtama: u, tipeDurasi: tipe });

	return {
		status: susunStatusLegacy(u, tipe),
		tipe_durasi: tipe,
		sesi,
		jam_mulai_izin: jamMulai,
		jam_selesai_izin: jamSelesai,
		total_durasi_jam: totalJam,
		potongan_hari: potonganHari,
		// Back-compat: konsumen lama (payroll/izinJamEngine) masih membaca durasi_izin_jam.
		durasi_izin_jam: tipe === TIPE_DURASI.HOURLY ? Number(totalJam) || 0 : 0
	};
}

/**
 * Kebalikan susunPayloadDurasi: baca sebuah baris `absensi_harian` (schema lama ATAU baru)
 * jadi bentuk kanonik untuk UI / rekap.
 * @param {Record<string, any>} record
 * @returns {{ statusUtama: string|null, tipeDurasi: string, sesi: string|null, jamMulai: string|null, jamSelesai: string|null, totalDurasiJam: number|null, potonganHari: number }}
 */
export function bacaDurasiDariRecord(record = {}) {
	const statusUtama = normalizeStatusUtama(record.status);
	const derivedTipe = deriveTipeDurasi(record.status, record);
	const storedTipe = record.tipe_durasi ? String(record.tipe_durasi).toUpperCase() : null;
	// Kolom tipe_durasi dibuat dgn default 'FULL_DAY' -> baris lama / hasil generate cuti yg belum
	// di-backfill akan bernilai 'FULL_DAY' walau status legacy jelas 1/2 hari / per jam. Dalam kasus
	// itu percayai derivasi dari status. Nilai HALF_DAY/HOURLY yang tersimpan eksplisit tetap dihormati.
	const tipeDurasi =
		storedTipe && !(storedTipe === TIPE_DURASI.FULL_DAY && derivedTipe !== TIPE_DURASI.FULL_DAY)
			? storedTipe
			: derivedTipe;
	const sesi = record.sesi
		? String(record.sesi).toUpperCase()
		: (record.paruh_cuti_setengah_hari ? String(record.paruh_cuti_setengah_hari).toUpperCase() : null);
	const totalDurasiJam =
		record.total_durasi_jam != null
			? Number(record.total_durasi_jam)
			: (record.durasi_izin_jam != null ? Number(record.durasi_izin_jam) || null : null);
	return {
		statusUtama,
		tipeDurasi,
		sesi: sesi === 'PAGI' || sesi === 'SIANG' ? sesi : null,
		jamMulai: record.jam_mulai_izin || null,
		jamSelesai: record.jam_selesai_izin || null,
		totalDurasiJam: Number.isFinite(totalDurasiJam) ? totalDurasiJam : null,
		// Selalu diturunkan dari statusUtama + tipeDurasi yang sudah diresolusi — kolom potongan_hari
		// tersimpan (default 0) tidak bisa dipercaya untuk baris lama yg belum di-backfill.
		potonganHari: hitungPotonganHari({ statusUtama, tipeDurasi })
	};
}

// ==================== LABEL / BADGE REKAP ====================

const LABEL_UTAMA = {
	HADIR: 'HADIR',
	CUTI: 'CUTI',
	IZIN: 'IZIN',
	SAKIT: 'SAKIT',
	DINAS_LUAR: 'DINAS LUAR',
	ALPA: 'ALPA'
};

const LABEL_SESI = { PAGI: 'Pagi', SIANG: 'Siang' };

/** Buang detik dari 'HH:mm:ss' -> 'HH:mm'. */
function rapikanJam(j) {
	return typeof j === 'string' ? j.slice(0, 5) : j;
}

/**
 * Format badge untuk tabel rekap/monitoring.
 * Contoh keluaran:
 *   "CUTI (1/2 Hari - Pagi)"
 *   "IZIN (2 Jam: 10:00 - 12:00)"
 *   "SAKIT (Full Day)"
 *   "DINAS LUAR (1/2 Hari - Siang)"
 *
 * @param {Record<string, any>} record baris `absensi_harian` (schema lama atau baru)
 * @returns {string}
 */
export function formatBadgeAbsensi(record = {}) {
	const { statusUtama, tipeDurasi, sesi, jamMulai, jamSelesai, totalDurasiJam } =
		bacaDurasiDariRecord(record);

	if (!statusUtama) return String(record.status || '-').toUpperCase();

	const label = LABEL_UTAMA[statusUtama] || statusUtama;
	if (statusUtama === STATUS_UTAMA.HADIR || statusUtama === STATUS_UTAMA.ALPA) return label;

	let detail;
	if (tipeDurasi === TIPE_DURASI.HALF_DAY) {
		detail = sesi ? `1/2 Hari - ${LABEL_SESI[sesi] || sesi}` : '1/2 Hari';
	} else if (tipeDurasi === TIPE_DURASI.HOURLY) {
		const jamTxt = Number.isFinite(totalDurasiJam) && totalDurasiJam > 0
			? `${formatAngkaJam(totalDurasiJam)} Jam`
			: 'Per Jam';
		detail = jamMulai && jamSelesai
			? `${jamTxt}: ${rapikanJam(jamMulai)} - ${rapikanJam(jamSelesai)}`
			: jamTxt;
	} else {
		detail = 'Full Day';
	}
	return `${label} (${detail})`;
}

/** 2 -> "2", 2.5 -> "2,5" (format ID). */
export function formatAngkaJam(n) {
	const num = Number(n);
	if (!Number.isFinite(num)) return '0';
	return Number.isInteger(num) ? String(num) : String(num).replace('.', ',');
}

/** Badge pendek untuk chip/kolom sempit: "1/2 Pagi", "2,5 Jam", "Full". */
export function formatBadgeSingkat(record = {}) {
	const { statusUtama, tipeDurasi, sesi, totalDurasiJam } = bacaDurasiDariRecord(record);
	if (!statusUtama || statusUtama === STATUS_UTAMA.HADIR || statusUtama === STATUS_UTAMA.ALPA) {
		return LABEL_UTAMA[statusUtama] || String(record.status || '-');
	}
	if (tipeDurasi === TIPE_DURASI.HALF_DAY) return `1/2${sesi ? ' ' + (LABEL_SESI[sesi] || sesi) : ''}`;
	if (tipeDurasi === TIPE_DURASI.HOURLY) {
		return Number.isFinite(totalDurasiJam) && totalDurasiJam > 0 ? `${formatAngkaJam(totalDurasiJam)} Jam` : 'Per Jam';
	}
	return 'Full';
}

export default {
	STATUS_UTAMA,
	TIPE_DURASI,
	SESI,
	DEFAULT_SESI_JAM,
	JAM_KERJA_STANDAR,
	TIPE_DURASI_DIIZINKAN,
	menitDariJam,
	jamDariMenit,
	hitungDurasiJam,
	validasiRentangJam,
	jamUntukSesi,
	normalizeStatusUtama,
	deriveTipeDurasi,
	susunStatusLegacy,
	hitungPotonganHari,
	hitungPotonganSaldoCuti,
	jamKeProporsiHari,
	validasiInputDurasi,
	susunPayloadDurasi,
	bacaDurasiDariRecord,
	formatBadgeAbsensi,
	formatBadgeSingkat,
	formatAngkaJam
};
