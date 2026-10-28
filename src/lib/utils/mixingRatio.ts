// src/lib/utils/mixingRatio.ts
// Rekomendasi Tambahan #2 (Pertajam Modul R&D v2, 3 Sep 2026) — Kalkulator Campuran lapangan.
// Matematikanya SENGAJA disalin persis dari erp-epi src/lib/utils/mixingRatioUtils.js supaya
// hasil hitung field sama dengan yang dipakai admin/produksi — bukan rumus baru.
//
// HANYA rasio komponen (mis. Base:Hardener 4:1) yang dipakai di sini — BUKAN komposisi bahan
// baku (persentase resin/pigmen/solvent), yang tetap rahasia dagang dan tidak pernah diambil
// dari `template_formula.supplier`/`presentase` di modul ini (lihat rndMixing.ts).

export interface MixComponent {
	id: string;
	name: string;
	ratio: number;
	percentage: number;
	qty_kg: number;
	qty_liter: number;
}

const DEFAULT_COMPONENT_NAMES = ['Base', 'Hardener', 'Catalyst', 'Additive'];

export function parseMixingRatio(ratioStr: string | null | undefined): number[] {
	if (!ratioStr || !String(ratioStr).trim()) return [1];
	const parts = String(ratioStr)
		.split(':')
		.map((p) => parseFloat(p.trim()))
		.filter((n) => !isNaN(n) && n > 0);
	return parts.length > 0 ? parts : [1];
}

export function isMultiComponent(ratioStr: string | null | undefined): boolean {
	return parseMixingRatio(ratioStr).length > 1;
}

/**
 * Hitung kg & liter tiap komponen dari total target batch.
 * @param totalQty Total campuran target (kg jika type='by_weight', liter jika 'by_volume')
 * @param ratioStr Mis. "4:1"
 * @param type 'by_weight' | 'by_volume'
 * @param sg Specific gravity — wajib untuk konversi kg<->liter
 */
export function calculateComponentsWithConversion(
	totalQty: number,
	ratioStr: string | null | undefined,
	type: 'by_weight' | 'by_volume' | string | null | undefined,
	sg: number | null | undefined
): MixComponent[] {
	const ratioArr = parseMixingRatio(ratioStr);
	const totalRatio = ratioArr.reduce((a, b) => a + b, 0);
	const effectiveSg = sg && sg > 0 ? sg : 1;

	return ratioArr.map((ratio, i) => {
		const percentage = (ratio / totalRatio) * 100;
		const qty = (ratio / totalRatio) * (totalQty || 0);
		const qty_kg = type === 'by_volume' ? qty * effectiveSg : qty;
		const qty_liter = type === 'by_volume' ? qty : qty / effectiveSg;
		return {
			id: String.fromCharCode(65 + i), // A, B, C, ...
			name: DEFAULT_COMPONENT_NAMES[i] || `Komponen ${i + 1}`,
			ratio,
			percentage,
			qty_kg,
			qty_liter
		};
	});
}
