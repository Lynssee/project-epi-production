// src/lib/utils/dewPoint.ts
// Kalkulator Dew Point & kelayakan pengecatan (blueprint SOP R&D Fase 6, IK-RND-010A / TRN-RND-10).
// MURNI, zero-API: rumus Magnus-Tetens di client. Acuan: ISO 8502-4 — suhu substrat minimal 3 °C di atas dew point;
// RH > 85% berisiko amine blushing pada sistem epoksi/pengeras amina. Ambang dapat diganti pemanggil (default = acuan di atas).

export const DEW_POINT_DEFAULTS = Object.freeze({ minMarginC: 3, maxRhPercent: 85 });

// Konstanta Magnus (Sonntag 1990), valid ±-45…60 °C.
const A = 17.62;
const B = 243.12;

/** Dew point (°C) dari suhu udara (°C) dan RH (%). Null bila input tak valid. */
export function dewPointC(tempC: number, rhPercent: number): number | null {
	const t = Number(tempC);
	const rh = Number(rhPercent);
	if (!Number.isFinite(t) || !Number.isFinite(rh) || rh <= 0 || rh > 100 || t < -45 || t > 60) return null;
	const g = Math.log(rh / 100) + (A * t) / (B + t);
	return (B * g) / (A - g);
}

export type DewVerdict = 'aman' | 'bahaya';
export interface DewPointAssessment {
	dewPointC: number;
	marginC: number; // suhu substrat − dew point
	verdict: DewVerdict;
	reasons: string[];
}

/**
 * Nilai kelayakan mengecat. Bahaya bila margin substrat–dew point < minMarginC ATAU RH > maxRhPercent.
 * @returns null bila ada input tidak valid (kosong/NaN/di luar rentang).
 */
export function assessPainting(
	input: { airTempC: number; rhPercent: number; substrateTempC: number },
	opt: Partial<typeof DEW_POINT_DEFAULTS> = {}
): DewPointAssessment | null {
	const { minMarginC, maxRhPercent } = { ...DEW_POINT_DEFAULTS, ...opt };
	const sub = Number(input.substrateTempC);
	const dp = dewPointC(input.airTempC, input.rhPercent);
	if (dp === null || !Number.isFinite(sub) || sub < -45 || sub > 120) return null;
	const margin = sub - dp;
	const reasons: string[] = [];
	if (margin < minMarginC) reasons.push(`Suhu pelat hanya ${margin.toFixed(1)} °C di atas dew point (minimal ${minMarginC} °C) — risiko kondensasi/blistering.`);
	if (Number(input.rhPercent) > maxRhPercent) reasons.push(`RH ${Number(input.rhPercent).toFixed(0)}% di atas ${maxRhPercent}% — risiko amine blushing.`);
	return { dewPointC: dp, marginC: margin, verdict: reasons.length ? 'bahaya' : 'aman', reasons };
}
