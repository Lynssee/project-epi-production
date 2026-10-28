// src/lib/utils/inspectionCalc.ts
// Port dari erp-epi-1/src/lib/utils/inspectionCalc.js — HARUS tetap sinkron secara
// matematis dengan versi admin. Rumus psychrometric (RH & Dew Point), guard hold
// point, dan validasi DFT SSPC-PA2 (85/15) untuk Blasting & Painting Inspection
// Report (BPIR). Jangan ubah rumus tanpa menyamakan juga di erp-epi-1.

const num = (v: any, d = 0): number => {
	const n = parseFloat(v);
	return Number.isFinite(n) ? n : d;
};

// ====================== PSYCHROMETRIC ======================

// Konstanta Magnus-Tetens (berlaku di atas air, 0-50°C — WMO).
const MAGNUS_A = 17.62;
const MAGNUS_B = 243.12;

// Konstanta psychrometer teraspirasi (Assmann/Sprung), per °C.
const PSYCHROMETER_CONSTANT = 0.000662;

// Tekanan atmosfer standar permukaan laut (hPa). Override bila lokasi
// proyek jauh di atas permukaan laut.
const DEFAULT_PRESSURE_HPA = 1013.25;

function saturationVaporPressure(tempC: number): number {
	return 6.112 * Math.exp((MAGNUS_A * tempC) / (MAGNUS_B + tempC));
}

export interface PsychrometricResult {
	rhPct: number | null;
	dewPointC: number | null;
}

/**
 * Hitung RH (%) & Dew Point (°C) dari Dry Bulb & Wet Bulb menggunakan
 * formula psychrometer teraspirasi (Sprung) + Magnus-Tetens.
 * Divalidasi terhadap PT. PLP PO 31391: Dry Bulb 31°C, Wet Bulb 26°C
 * → RH ≈ 67.55%, Dew Point ≈ 24.29°C.
 */
export function calcPsychrometric({
	dryBulb,
	wetBulb,
	pressureHpa = DEFAULT_PRESSURE_HPA
}: {
	dryBulb: number | string | null | undefined;
	wetBulb: number | string | null | undefined;
	pressureHpa?: number;
}): PsychrometricResult {
	const tdb = num(dryBulb, NaN);
	const twb = num(wetBulb, NaN);
	const p = num(pressureHpa, DEFAULT_PRESSURE_HPA);

	if (!Number.isFinite(tdb) || !Number.isFinite(twb)) {
		return { rhPct: null, dewPointC: null };
	}

	const esWet = saturationVaporPressure(twb);
	const esDry = saturationVaporPressure(tdb);
	const eActual = esWet - PSYCHROMETER_CONSTANT * p * (tdb - twb);

	if (eActual <= 0) {
		return { rhPct: 0, dewPointC: null };
	}

	const rhPct = Math.min(100, Math.max(0, (100 * eActual) / esDry));

	const lnRatio = Math.log(eActual / 6.112);
	const dewPointC = (MAGNUS_B * lnRatio) / (MAGNUS_A - lnRatio);

	return {
		rhPct: Math.round(rhPct * 100) / 100,
		dewPointC: Math.round(dewPointC * 100) / 100
	};
}

// ====================== HOLD POINT GUARD ======================

// Aturan pengecatan: pekerjaan tidak boleh dilanjutkan bila
// Steel Temp < Dew Point + 3°C.
export const HOLD_POINT_MARGIN_C = 3;

export interface HoldPointResult {
	holdPoint: boolean;
	margin: number | null;
}

export function checkHoldPoint({
	steelTemp,
	dewPointC
}: {
	steelTemp: number | string | null | undefined;
	dewPointC: number | string | null | undefined;
}): HoldPointResult {
	const steel = num(steelTemp, NaN);
	const dew = num(dewPointC, NaN);
	if (!Number.isFinite(steel) || !Number.isFinite(dew)) {
		return { holdPoint: false, margin: null };
	}
	const margin = steel - dew;
	return {
		holdPoint: margin < HOLD_POINT_MARGIN_C,
		margin: Math.round(margin * 100) / 100
	};
}

// ====================== DFT SSPC-PA2 ======================

/**
 * Rata-rata titik ukur DFT.
 */
export function calcDftAverage(readings: (number | string | null | undefined)[] = []): number | null {
	const valid = readings.map((r) => num(r, NaN)).filter((v) => Number.isFinite(v));
	if (valid.length === 0) return null;
	const sum = valid.reduce((a, b) => a + b, 0);
	return Math.round((sum / valid.length) * 100) / 100;
}

export interface Dft8515Result {
	pass: boolean | null;
	avg: number | null;
	belowSpecCount: number;
	belowSpecPct: number;
	failures: string[];
}

/**
 * Validasi aturan 85/15 SSPC-PA2:
 * - Rata-rata keseluruhan harus berada dalam rentang spec min/max.
 * - Maksimal 15% titik ukur boleh di bawah spec min.
 * - Tidak ada titik ukur di bawah 80% spec min (batas mutlak SSPC-PA2).
 */
export function validateDft8515(
	readings: (number | string | null | undefined)[] = [],
	specMin: number | string | null | undefined,
	specMax: number | string | null | undefined,
	{ minReadingFactor = 0.8 }: { minReadingFactor?: number } = {}
): Dft8515Result {
	const valid = readings.map((r) => num(r, NaN)).filter((v) => Number.isFinite(v));
	const min = num(specMin, NaN);
	const max = num(specMax, NaN);

	if (valid.length === 0 || !Number.isFinite(min)) {
		return { pass: null, avg: null, belowSpecCount: 0, belowSpecPct: 0, failures: [] };
	}

	const avg = calcDftAverage(valid) as number;
	const failures: string[] = [];

	if (avg < min) {
		failures.push(`Rata-rata ${avg}µm di bawah spec min ${min}µm`);
	}
	if (Number.isFinite(max) && avg > max) {
		failures.push(`Rata-rata ${avg}µm di atas spec max ${max}µm`);
	}

	const belowSpec = valid.filter((v) => v < min);
	const belowSpecPct = Math.round((belowSpec.length / valid.length) * 10000) / 100;
	if (belowSpecPct > 15) {
		failures.push(`${belowSpecPct}% titik ukur di bawah spec min (maks 15% diizinkan)`);
	}

	const minFloor = min * minReadingFactor;
	const tooLow = valid.filter((v) => v < minFloor);
	if (tooLow.length > 0) {
		failures.push(`${tooLow.length} titik ukur di bawah ${minFloor.toFixed(1)}µm (80% spec min — tidak diizinkan sama sekali)`);
	}

	return {
		pass: failures.length === 0,
		avg,
		belowSpecCount: belowSpec.length,
		belowSpecPct,
		failures
	};
}

// ====================== REPORT NUMBER ======================

/**
 * Format nomor laporan otomatis: IREPIOG-YYMMDD-urut (contoh: IREPIOG-260716-001).
 * `seq` adalah urutan harian per workshop (1-based), dipadding 3 digit.
 */
export function formatReportNo(date: Date = new Date(), seq = 1): string {
	const yy = String(date.getFullYear()).slice(-2);
	const mm = String(date.getMonth() + 1).padStart(2, '0');
	const dd = String(date.getDate()).padStart(2, '0');
	const seqStr = String(seq).padStart(3, '0');
	return `IREPIOG-${yy}${mm}${dd}-${seqStr}`;
}
