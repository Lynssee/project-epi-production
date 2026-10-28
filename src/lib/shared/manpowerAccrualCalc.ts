// src/lib/shared/manpowerAccrualCalc.ts
// Perhitungan biaya harian manpower — SATU sumber kebenaran, dipakai dua sisi:
//   - klien: services/manpowerAbsensi.ts (timesheet, SDK lewat proxy)
//   - server: routes/api/manpower-leader/absen-regu (absensi regu oleh Manpower Leader)
//
// Sengaja MURNI (tanpa akses DB/SDK/window) supaya bisa diimpor dari keduanya.
// Ini jalur uang: absensi → project_expenses. Kalau logikanya diduplikasi per sisi,
// cepat atau lambat keduanya berbeda dan selisihnya baru ketahuan saat gajian.

/** Faktor upah per status kehadiran. Status di luar daftar ini bernilai 0. */
export const HADIR_FACTOR: Record<string, number> = { hadir: 1, setengah_hari: 0.5 };

export interface RateManpower {
	/** Rate harian efektif — prioritas assignment di atas master manpower. */
	rateHarian: number;
	rateLembur: number;
	rateStandby: number;
	rateUangMakan: number;
}

export interface KondisiHari {
	status: string;
	is_standby?: boolean | null;
	is_holiday?: boolean | null;
	ot_hours?: number | null;
	uang_makan?: boolean | null;
}

/**
 * Pilih rate efektif: assignment menang atas master manpower.
 * Dipisah supaya kedua sisi tidak salah urutan prioritas.
 */
export function pilihRate(assignment: any, manpower: any): RateManpower {
	return {
		rateHarian: Number(
			assignment?.rate_harian || assignment?.rate_upah_harian || manpower?.rate_upah_harian || 0
		),
		rateLembur: Number(assignment?.rate_lembur || manpower?.rate_lembur || 0),
		rateStandby: Number(assignment?.rate_standby || manpower?.rate_standby || 0),
		rateUangMakan: Number(assignment?.rate_uang_makan || 0)
	};
}

/**
 * Biaya harian satu baris absensi.
 * @param holidayMultiplier pengali hari libur — diambil pemanggil dari app_settings
 *        (klien: getManpowerSetting; server: settings server) supaya fungsi ini tetap murni.
 */
export function hitungBiayaHarian(
	kondisi: KondisiHari,
	rate: RateManpower,
	holidayMultiplier = 1.5
): number {
	const uangMakan = kondisi.uang_makan ? rate.rateUangMakan : 0;

	if (kondisi.is_standby) return rate.rateStandby + uangMakan;

	const factor = HADIR_FACTOR[kondisi.status] ?? (kondisi.status === 'hadir' ? 1 : 0);
	let upahHarian = rate.rateHarian * factor;
	if (kondisi.is_holiday) upahHarian *= holidayMultiplier;

	const lembur = (Number(kondisi.ot_hours) || 0) * rate.rateLembur;
	return Math.round(upahHarian + lembur + uangMakan);
}

/**
 * R2-02 — True bila baris absensi seharusnya berbiaya tetapi rate-nya 0 (penugasan/master tanpa rate).
 * Pemanggil WAJIB mencatat jejak server (activity_log) agar Rp0 tidak terjadi diam-diam; fungsi ini
 * tetap murni. Status tak berbiaya (izin/sakit/alpha) dan standby tanpa rate standby dinilai sendiri.
 */
export function rateKosong(kondisi: KondisiHari, rate: RateManpower): boolean {
	if (kondisi.is_standby) return rate.rateStandby <= 0;
	const factor = HADIR_FACTOR[kondisi.status] ?? 0;
	return factor > 0 && rate.rateHarian <= 0;
}
