// Quick Ballpark Pricing Engine — estimasi kasar untuk survey lapangan & omnichannel.
// Pure function, zero-dependency, isomorphic (dipakai sama di erp-epi & project-epi).
// Rumus: lihat (transfer) rencana_fitur_quick_estimasi_survey_omnichannel.md §3.

export const QUICK_ESTIMATOR_JASA = ['sandblasting', 'painting', 'floor_coating'] as const;
export type QuickEstimatorJasa = (typeof QUICK_ESTIMATOR_JASA)[number];

const DEFAULT_BUFFER_PCT = 0.125;

export interface QuickEstimatorRates {
	[jasa: string]: { base_rate_per_m2: number; label?: string };
}

export interface QuickEstimatorMultipliers {
	kondisi_permukaan?: Record<string, number>;
	utilitas?: { listrik_tidak_ada_rp?: number; air_tidak_ada_rp?: number };
	buffer_pct?: number;
}

export interface QuickEstimateInput {
	jenisJasa: string;
	luasArea: number | string;
	kondisiPermukaan?: string;
	listrikTersedia?: string;
	airTersedia?: string;
	rates: QuickEstimatorRates;
	multipliers?: QuickEstimatorMultipliers;
}

export interface QuickEstimateRange {
	nilai: number;
	min: number;
	max: number;
}

export interface QuickEstimateResult {
	valid: boolean;
	errors: string[];
	jenisJasa?: string;
	luasArea?: number;
	baseRatePerM2?: number;
	multiplierKondisi?: number;
	biayaUtilitas?: number;
	utilitasBreakdown?: { label: string; amount: number }[];
	bufferPct?: number;
	estimasiPerM2?: QuickEstimateRange;
	estimasiTotal?: QuickEstimateRange;
}

function toNumber(v: unknown, fallback = 0): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

export function calculateQuickEstimate({
	jenisJasa,
	luasArea,
	kondisiPermukaan,
	listrikTersedia,
	airTersedia,
	rates,
	multipliers
}: QuickEstimateInput): QuickEstimateResult {
	const errors: string[] = [];
	const luas = toNumber(luasArea, 0);

	if (!jenisJasa || !rates || !rates[jenisJasa] || !toNumber(rates[jenisJasa].base_rate_per_m2, 0)) {
		errors.push('Base rate untuk jenis jasa ini belum diatur. Hubungi admin untuk mengisi parameter di Pengaturan Sales.');
	}
	if (luas <= 0) {
		errors.push('Luas area harus lebih dari 0 m².');
	}
	if (errors.length) return { valid: false, errors };

	const baseRatePerM2 = toNumber(rates[jenisJasa].base_rate_per_m2, 0);
	const multiplierKondisi = kondisiPermukaan ? toNumber(multipliers?.kondisi_permukaan?.[kondisiPermukaan], 1) : 1;

	const utilitas = multipliers?.utilitas || {};
	const utilitasBreakdown: { label: string; amount: number }[] = [];
	let biayaUtilitas = 0;
	if (listrikTersedia === 'TIDAK ADA' && toNumber(utilitas.listrik_tidak_ada_rp, 0) > 0) {
		const amount = toNumber(utilitas.listrik_tidak_ada_rp, 0);
		biayaUtilitas += amount;
		utilitasBreakdown.push({ label: 'Sewa genset (listrik tidak tersedia)', amount });
	}
	if (airTersedia === 'TIDAK ADA' && toNumber(utilitas.air_tidak_ada_rp, 0) > 0) {
		const amount = toNumber(utilitas.air_tidak_ada_rp, 0);
		biayaUtilitas += amount;
		utilitasBreakdown.push({ label: 'Truk tangki air (air tidak tersedia)', amount });
	}

	const bufferRaw = multipliers?.buffer_pct;
	const bufferPct = Number.isFinite(Number(bufferRaw)) ? Number(bufferRaw) : DEFAULT_BUFFER_PCT;

	const estimasiPerM2 = baseRatePerM2 * multiplierKondisi + biayaUtilitas / luas;
	const estimasiTotal = estimasiPerM2 * luas;

	return {
		valid: true,
		errors: [],
		jenisJasa,
		luasArea: luas,
		baseRatePerM2,
		multiplierKondisi,
		biayaUtilitas,
		utilitasBreakdown,
		bufferPct,
		estimasiPerM2: {
			nilai: estimasiPerM2,
			min: estimasiPerM2 * (1 - bufferPct),
			max: estimasiPerM2 * (1 + bufferPct)
		},
		estimasiTotal: {
			nilai: estimasiTotal,
			min: estimasiTotal * (1 - bufferPct),
			max: estimasiTotal * (1 + bufferPct)
		}
	};
}

export function formatRupiah(value: number | null | undefined): string {
	return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(
		Math.round(toNumber(value, 0))
	);
}

export function formatQuickEstimateRange(result: QuickEstimateResult, opts: { perM2?: boolean } = {}): string {
	if (!result?.valid) return '';
	const target = opts.perM2 ? result.estimasiPerM2! : result.estimasiTotal!;
	return `${formatRupiah(target.min)} – ${formatRupiah(target.max)}${opts.perM2 ? '/m²' : ''}`;
}

/** Template draft chat WA — bahasa santun, menegaskan ini angka kasar bukan penawaran resmi. */
export function buildWhatsAppDraft(
	result: QuickEstimateResult,
	opts: { jasaLabel?: string; customerName?: string } = {}
): string {
	if (!result?.valid) return '';
	const jasaLabel = opts.jasaLabel || result.jenisJasa;
	const sapaan = opts.customerName ? `Selamat siang Bapak/Ibu ${opts.customerName},\n\n` : '';
	const rangeTotal = formatQuickEstimateRange(result);
	const rangePerM2 = formatQuickEstimateRange(result, { perM2: true });
	return (
		`${sapaan}Berdasarkan informasi awal yang kami terima, estimasi kasar pekerjaan ${jasaLabel} ` +
		`untuk luas ±${result.luasArea!.toLocaleString('id-ID')} m² berkisar ${rangeTotal} (±${rangePerM2}).\n\n` +
		`Angka ini masih bersifat perkiraan awal. Harga resmi akan kami finalisasi melalui Surat Penawaran ` +
		`setelah survey/verifikasi teknis lebih lanjut. Terima kasih.`
	);
}
