// src/lib/server/ess/overtimeCalculator.ts
// Engine kalkulator multiplier upah lembur sesuai Regulasi PP No. 35 / 2021 & Kepmenaker 102/2004.

export interface OvertimeDetail {
	jamKe: number;
	multiplier: number;
	jamSetara: number;
}

export interface OvertimeCalculationResult {
	durasiJam: number;
	isHariLibur: boolean;
	totalJamSetara: number;
	multiplierBreakdown: string;
	details: OvertimeDetail[];
}

/**
 * Memeriksa apakah tanggal jatuh pada akhir pekan (Sabtu / Minggu).
 */
export function isWeekend(tanggalStr: string): boolean {
	const d = new Date(tanggalStr + 'T00:00:00+07:00');
	const day = d.getDay();
	return day === 0 || day === 6; // 0 = Minggu, 6 = Sabtu
}

/**
 * Menghitung selisih jam antara jam mulai dan jam selesai (dalam jam desimal, misal 2.5 jam).
 */
export function calculateDurationHours(jamMulai: string, jamSelesai: string): number {
	const [mH, mM] = jamMulai.split(':').map(Number);
	const [sH, sM] = jamSelesai.split(':').map(Number);

	const startMinutes = mH * 60 + mM;
	let endMinutes = sH * 60 + sM;

	if (endMinutes <= startMinutes) {
		// Jika lewat tengah malam
		endMinutes += 24 * 60;
	}

	const diffMinutes = endMinutes - startMinutes;
	return Math.round((diffMinutes / 60) * 100) / 100;
}

/**
 * Kebijakan pembulatan durasi lembur: dibulatkan ke bawah per kelipatan 30 menit,
 * minimum 30 menit (di bawah itu tidak dihitung). Mis. 1 jam 50 menit -> 1.5 jam.
 */
export function roundOvertimeDuration(rawHours: number): number {
	const totalMinutes = rawHours * 60;
	const flooredMinutes = Math.floor(totalMinutes / 30) * 30;
	if (flooredMinutes < 30) return 0;
	return Math.round((flooredMinutes / 60) * 100) / 100;
}

/**
 * Mengkalkulasi jam lembur setara berdasarkan aturan PP No. 35 / 2021.
 */
export function calculateOvertimeMultipliers(params: {
	tanggal: string;
	jamMulai: string;
	jamSelesai: string;
	isNationalHoliday?: boolean;
}): OvertimeCalculationResult {
	const { tanggal, jamMulai, jamSelesai, isNationalHoliday = false } = params;
	const isLibur = isWeekend(tanggal) || isNationalHoliday;

	let rawDuration = calculateDurationHours(jamMulai, jamSelesai);
	
	// Pemotongan 1 jam istirahat untuk hari libur jika total jam kerja >= 8 jam
	if (isLibur && rawDuration >= 8) {
		rawDuration -= 1;
	}

	const durasiJam = roundOvertimeDuration(Math.max(0, rawDuration));
	const details: OvertimeDetail[] = [];

	let totalJamSetara = 0;
	const roundedHours = Math.ceil(durasiJam);

	for (let i = 1; i <= roundedHours; i++) {
		// Porsi jam penuh (1.0) atau sisa pecahan jika di jam terakhir
		const hoursInThisStep = i === roundedHours ? (durasiJam % 1 === 0 ? 1 : durasiJam % 1) : 1;
		let mult = 1.5;

		if (!isLibur) {
			// Hari Kerja Biasa:
			// Jam ke-1 = 1.5x, Jam ke-2+ = 2.0x
			if (i === 1) {
				mult = 1.5;
			} else {
				mult = 2.0;
			}
		} else {
			// Hari Libur / Weekend (pola 5 hari kerja — kanon, samakan dgn admin payrollSync.js):
			// Jam 1-8 = 2.0x, Jam 9 = 3.0x, Jam 10+ = 4.0x
			if (i <= 8) {
				mult = 2.0;
			} else if (i === 9) {
				mult = 3.0;
			} else {
				mult = 4.0;
			}
		}

		const jamSetara = Math.round(hoursInThisStep * mult * 100) / 100;
		totalJamSetara += jamSetara;

		details.push({
			jamKe: i,
			multiplier: mult,
			jamSetara
		});
	}

	totalJamSetara = Math.round(totalJamSetara * 100) / 100;

	// Buat ringkasan breakdown teks
	const summaryParts: string[] = [];
	if (!isLibur) {
		const jam1 = Math.min(durasiJam, 1);
		const jam2plus = Math.max(0, durasiJam - 1);
		if (jam1 > 0) summaryParts.push(`${jam1} jam @ 1.5x`);
		if (jam2plus > 0) summaryParts.push(`${jam2plus} jam @ 2.0x`);
	} else {
		summaryParts.push(`${durasiJam} jam (Hari Libur/Weekend) @ pengali 2.0x - 4.0x`);
	}

	return {
		durasiJam,
		isHariLibur: isLibur,
		totalJamSetara,
		multiplierBreakdown: summaryParts.join(' + '),
		details
	};
}
