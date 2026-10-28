/**
 * Kalkulator Buku Saku Cat (EPI Academy) — fungsi murni, tanpa API/Directus.
 * Rumus mengikuti materi Pilar 2 (KC-P2-COATING). Input tak valid → null (UI menampilkan "isi data dulu"),
 * jangan pernah melempar error ke layar lapangan.
 */

/** Selisih minimal suhu permukaan terhadap dew point (°C) dan RH maksimum (%) — aturan wajib lapangan EPI. */
export const DEW_MARGIN_C = 3;
export const RH_MAX_PERSEN = 85;
/** Acuan kehilangan produktivitas blasting per 1 PSI penurunan tekanan di nozzle. */
export const BLAST_LOSS_PER_PSI = 1.5;
export const BLAST_PSI_IDEAL = 100;

const num = (v: unknown): number | null => {
	// Kolom kosong/null harus dianggap "belum diisi", bukan 0 (Number('') === 0, Number(null) === 0).
	if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
	const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
	return Number.isFinite(n) ? n : null;
};
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** Dew point (°C) dari suhu udara (°C) dan RH (%), rumus Magnus. */
export function dewPoint(suhuUdara: unknown, rh: unknown): number | null {
	const t = num(suhuUdara);
	const h = num(rh);
	if (t === null || h === null || h <= 0 || h > 100 || t < -40 || t > 70) return null;
	const a = 17.62;
	const b = 243.12;
	const g = Math.log(h / 100) + (a * t) / (b + t);
	return round((b * g) / (a - g), 1);
}

export interface CekAplikasi {
	dewPoint: number;
	selisih: number; // suhu baja − dew point
	suhuOk: boolean;
	rhOk: boolean;
	boleh: boolean;
	alasan: string[];
}

/** Boleh mengecat? Suhu baja ≥ dew point + margin dan RH ≤ batas. */
export function cekAplikasi(suhuUdara: unknown, rh: unknown, suhuBaja: unknown, margin = DEW_MARGIN_C, rhMax = RH_MAX_PERSEN): CekAplikasi | null {
	const dp = dewPoint(suhuUdara, rh);
	const baja = num(suhuBaja);
	const h = num(rh);
	if (dp === null || baja === null || h === null) return null;
	const selisih = round(baja - dp, 1);
	const suhuOk = selisih >= margin;
	const rhOk = h <= rhMax;
	const alasan: string[] = [];
	if (!suhuOk) alasan.push(`Suhu baja hanya ${selisih}°C di atas dew point (minimal ${margin}°C).`);
	if (!rhOk) alasan.push(`RH ${h}% melebihi batas ${rhMax}%.`);
	return { dewPoint: dp, selisih, suhuOk, rhOk, boleh: suhuOk && rhOk, alasan };
}

const vsOk = (vs: number | null) => vs !== null && vs > 0 && vs <= 100;

/** WFT (µm) yang dibutuhkan untuk DFT target; thinnerPct = % thinner yang ditambahkan (opsional). */
export function wftDariDft(dft: unknown, volumeSolid: unknown, thinnerPct: unknown = 0): number | null {
	const d = num(dft);
	const vs = num(volumeSolid);
	const th = num(thinnerPct) ?? 0;
	if (d === null || d <= 0 || !vsOk(vs) || th < 0 || th > 50) return null;
	return round((d / ((vs as number) / 100)) * (1 + th / 100), 1);
}

/** DFT (µm) yang dihasilkan dari WFT terukur. */
export function dftDariWft(wft: unknown, volumeSolid: unknown, thinnerPct: unknown = 0): number | null {
	const w = num(wft);
	const vs = num(volumeSolid);
	const th = num(thinnerPct) ?? 0;
	if (w === null || w <= 0 || !vsOk(vs) || th < 0 || th > 50) return null;
	return round((w / (1 + th / 100)) * ((vs as number) / 100), 1);
}

/** Theoretical spreading rate (m²/liter). */
export function tsr(volumeSolid: unknown, dft: unknown): number | null {
	const vs = num(volumeSolid);
	const d = num(dft);
	if (!vsOk(vs) || d === null || d <= 0) return null;
	return round(((vs as number) * 10) / d, 2);
}

export interface KebutuhanCat {
	tsr: number;
	psr: number;
	liter: number;
}

/** Kebutuhan cat (liter) untuk luas tertentu. efisiensi 0–1 (mis. 0,8) dari RAP/standar proyek. */
export function kebutuhanCat(luasM2: unknown, volumeSolid: unknown, dft: unknown, efisiensi: unknown = 0.8): KebutuhanCat | null {
	const luas = num(luasM2);
	const ef = num(efisiensi);
	const t = tsr(volumeSolid, dft);
	if (luas === null || luas <= 0 || ef === null || ef <= 0 || ef > 1 || t === null) return null;
	const psr = t * ef;
	return { tsr: t, psr: round(psr, 2), liter: round(luas / psr, 1) };
}

export interface KehilanganTekanan {
	turunPsi: number;
	kehilanganPersen: number;
}

/** Perkiraan kehilangan produktivitas blasting dari tekanan terukur DI nozzle. */
export function kehilanganTekanan(psiNozzle: unknown, psiIdeal: unknown = BLAST_PSI_IDEAL): KehilanganTekanan | null {
	const p = num(psiNozzle);
	const ideal = num(psiIdeal);
	if (p === null || p <= 0 || ideal === null || ideal <= 0) return null;
	const turun = Math.max(0, ideal - p);
	return { turunPsi: round(turun, 1), kehilanganPersen: round(Math.min(100, turun * BLAST_LOSS_PER_PSI), 1) };
}
