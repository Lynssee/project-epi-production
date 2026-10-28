// src/lib/utils/quotationCalc.ts
// Port dari erp-epi-1/src/lib/utils/quotationCalc.js — HARUS tetap sinkron secara
// matematis dengan versi admin. Hanya sandblasting/painting/floor_coating yang
// diporting (sipil & welding belum ada di enum kalkulator_penawaran_items.service_type
// di Directus, jadi di luar cakupan mobile ini). Jangan ubah rumus tanpa menyamakan
// juga di erp-epi-1 — lihat docs/sales-field-report-data-contract.md.

const num = (v: any, d = 0): number => {
	const n = parseFloat(v);
	return Number.isFinite(n) ? n : d;
};

export const SERVICE_TYPES = [
	{ id: 'sandblasting', label: 'Sandblasting', icon: '🌀' },
	{ id: 'painting', label: 'Painting / Pengecatan', icon: '🎨' },
	{ id: 'floor_coating', label: 'Floor Coating', icon: '🧱' }
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number]['id'];

export const SURFACE_PREP_STANDARDS = [
	{ id: 'SA1', label: 'SA 1 — Brush-off blast' },
	{ id: 'SA2', label: 'SA 2 — Commercial blast' },
	{ id: 'SA2.5', label: 'SA 2.5 — Near-white (umum)' },
	{ id: 'SA3', label: 'SA 3 — White metal' },
	{ id: 'St2', label: 'St 2 — Power tool (hand)' },
	{ id: 'St3', label: 'St 3 — Power tool (thorough)' }
];

export const SURFACE_CONDITIONS = [
	{ id: 'baru', label: 'Baja Baru / Mill scale' },
	{ id: 'karat_ringan', label: 'Karat Ringan' },
	{ id: 'karat_berat', label: 'Karat Berat / Pitting' },
	{ id: 'cat_lama', label: 'Cat Lama / Existing Coating' }
];

export const ABRASIVE_CONSUMPTION: Record<string, Record<string, number>> = {
	SA1: { baru: 18, karat_ringan: 22, karat_berat: 28, cat_lama: 25 },
	SA2: { baru: 25, karat_ringan: 30, karat_berat: 38, cat_lama: 35 },
	'SA2.5': { baru: 32, karat_ringan: 40, karat_berat: 50, cat_lama: 45 },
	SA3: { baru: 42, karat_ringan: 50, karat_berat: 62, cat_lama: 58 },
	St2: { baru: 0, karat_ringan: 0, karat_berat: 0, cat_lama: 0 },
	St3: { baru: 0, karat_ringan: 0, karat_berat: 0, cat_lama: 0 }
};

export const APPLICATION_METHODS = [
	{ id: 'kuas_roll', label: 'Kuas / Roll', loss: 0.2 },
	{ id: 'airless', label: 'Airless Spray', loss: 0.35 },
	{ id: 'konvensional', label: 'Konvensional Spray', loss: 0.45 }
];

export const FLOOR_SYSTEMS = [
	{ id: 'coating', label: 'Epoxy Coating (tipis)' },
	{ id: 'self_leveling', label: 'Self-Leveling' },
	{ id: 'mortar', label: 'Epoxy Mortar' },
	{ id: 'anti_slip', label: 'Anti-Slip' },
	{ id: 'anti_static', label: 'Anti-Static' }
];

export const DEFAULT_PRODUCTIVITY: Record<string, number> = {
	sandblasting: 60,
	painting: 150,
	floor_coating: 80
};

export const lossForMethod = (methodId: string) =>
	APPLICATION_METHODS.find((m) => m.id === methodId)?.loss ?? 0.35;

export const PRODUCTIVITY_FACTORS = {
	height: [
		{ id: 'normal', label: 'Normal (< 3m)', factor: 1.0 },
		{ id: 'tinggi', label: 'Tinggi (3–10m)', factor: 0.8 },
		{ id: 'sangat_tinggi', label: 'Sangat Tinggi (> 10m)', factor: 0.65 }
	],
	access: [
		{ id: 'mudah', label: 'Mudah / Terbuka', factor: 1.0 },
		{ id: 'terbatas', label: 'Terbatas / Scaffolding', factor: 0.75 },
		{ id: 'confined', label: 'Confined Space', factor: 0.55 }
	],
	shape: [
		{ id: 'plat', label: 'Plat / Datar', factor: 1.0 },
		{ id: 'pipa_besar', label: 'Pipa Besar (> 8")', factor: 0.9 },
		{ id: 'pipa_kecil', label: 'Pipa Kecil (≤ 8")', factor: 0.7 },
		{ id: 'struktur', label: 'Struktur Kompleks', factor: 0.65 }
	]
};

export function combinedProductivityFactor(inputs: any = {}): number {
	const h = PRODUCTIVITY_FACTORS.height.find((x) => x.id === inputs.factor_height)?.factor ?? 1;
	const a = PRODUCTIVITY_FACTORS.access.find((x) => x.id === inputs.factor_access)?.factor ?? 1;
	const s = PRODUCTIVITY_FACTORS.shape.find((x) => x.id === inputs.factor_shape)?.factor ?? 1;
	return Math.round(h * a * s * 1000) / 1000;
}

export const abrasiveDefault = (standard: string, condition: string) =>
	ABRASIVE_CONSUMPTION[standard]?.[condition] ?? 0;

export function workDays(totalArea: number, productivity: number, crew: number): number {
	const prod = num(productivity);
	const c = Math.max(1, num(crew, 1));
	if (totalArea <= 0 || prod <= 0) return 0;
	return Math.ceil(totalArea / (prod * c));
}

function totalCrewFromManpower(manpower: any[], crew: any, globalCrew: any): number {
	if (Array.isArray(manpower) && manpower.length) {
		return Math.max(1, manpower.reduce((s, m) => s + num(m.count, 1), 0));
	}
	if (globalCrew !== undefined) {
		return Math.max(1, num(globalCrew, 1));
	}
	return Math.max(1, num(crew, 1));
}

function totalDailyLaborCost(manpower: any[], crew: any, dailyWage: any, isGlobalLabor: boolean): number {
	if (isGlobalLabor) return 0;
	if (Array.isArray(manpower) && manpower.length) {
		return manpower.reduce((s, m) => s + num(m.count, 1) * num(m.dailyWage), 0);
	}
	return Math.max(1, num(crew, 1)) * num(dailyWage);
}

export function theoreticalSpreadingRate(volumeSolidsPct: any, dftMicron: any): number {
	const vs = num(volumeSolidsPct);
	const dft = num(dftMicron);
	if (vs <= 0 || dft <= 0) return 0;
	return (vs * 10) / dft;
}

export function paintConsumptionLiters(area: number, volumeSolidsPct: any, dftMicron: any, loss: any): number {
	const rate = theoreticalSpreadingRate(volumeSolidsPct, dftMicron);
	const l = num(loss);
	if (rate <= 0 || area <= 0) return 0;
	const effective = rate * (1 - l);
	if (effective <= 0) return 0;
	return area / effective;
}

export interface CostBreakdown {
	material: number;
	labor: number;
	equipment: number;
	consumable: number;
	subtotal: number;
	meta: Record<string, any>;
}

export function calcSandblasting(input: any = {}): CostBreakdown {
	const area = num(input.area) * num(input.qty, 1);
	const consumption = num(input.abrasiveConsumption);
	const price = num(input.abrasivePrice);
	const recycle = Math.min(0.95, Math.max(0, num(input.recyclePct)));

	const material = area * consumption * price * (1 - recycle);

	const totalCrew = totalCrewFromManpower(input.manpower, input.crew, input.globalCrew);
	const prodFactor = combinedProductivityFactor(input);
	const baseProd = num(input.productivity) || DEFAULT_PRODUCTIVITY.sandblasting;
	const days = workDays(area, baseProd * prodFactor, totalCrew);
	const dailyLabor = totalDailyLaborCost(input.manpower, input.crew, input.dailyWage, input.isGlobalLabor);
	const labor = days * dailyLabor;

	const equipment = days * (num(input.compressorRate) + num(input.fuelPerDay)) + num(input.nozzleAllowance);
	const consumable = num(input.consumable);
	const subtotal = material + labor + equipment + consumable;

	return {
		material,
		labor,
		equipment,
		consumable,
		subtotal,
		meta: { days, area, totalCrew, dailyLabor, prodFactor, effectiveProd: Math.round(baseProd * prodFactor) }
	};
}

export function calcPainting(input: any = {}): CostBreakdown {
	const area = num(input.area) * num(input.qty, 1);
	const coats = Array.isArray(input.coats) ? input.coats : [];

	let material = 0;
	const coatDetails = coats.map((c: any) => {
		const liters = paintConsumptionLiters(area, c.volumeSolids, c.dft, c.loss);
		const paintCost = liters * num(c.price);
		const thinnerLiters = liters * num(c.thinnerPct);
		const thinnerCost = thinnerLiters * num(c.thinnerPrice);
		material += paintCost + thinnerCost;
		return { liters, paintCost, thinnerLiters, thinnerCost };
	});

	const totalCrew = totalCrewFromManpower(input.manpower, input.crew, input.globalCrew);
	const prodFactor = combinedProductivityFactor(input);
	const baseProd = num(input.productivity) || DEFAULT_PRODUCTIVITY.painting;
	const days = workDays(area * Math.max(1, coats.length || 1), baseProd * prodFactor, totalCrew);
	const dailyLabor = totalDailyLaborCost(input.manpower, input.crew, input.dailyWage, input.isGlobalLabor);
	const labor = days * dailyLabor;
	const equipment = days * num(input.sprayerRate) + num(input.equipmentOther);
	const consumable = num(input.consumable);
	const subtotal = material + labor + equipment + consumable;

	return {
		material,
		labor,
		equipment,
		consumable,
		subtotal,
		meta: { days, area, totalCrew, dailyLabor, prodFactor, effectiveProd: Math.round(baseProd * prodFactor), coats: coatDetails }
	};
}

export function calcFloorCoating(input: any = {}): CostBreakdown {
	const area = num(input.area) * num(input.qty, 1);
	const layers = Array.isArray(input.layers) ? input.layers : [];

	let material = 0;
	const layerDetails = layers.map((l: any) => {
		const kg = area * num(l.consumption) * (1 + num(l.wastePct));
		const cost = kg * num(l.price);
		material += cost;
		return { kg, cost };
	});

	const prepCost = area * num(input.prepRate);

	const totalCrew = totalCrewFromManpower(input.manpower, input.crew, input.globalCrew);
	const prodFactor = combinedProductivityFactor(input);
	const baseProd = num(input.productivity) || DEFAULT_PRODUCTIVITY.floor_coating;
	const days = workDays(area * Math.max(1, layers.length || 1), baseProd * prodFactor, totalCrew);
	const dailyLabor = totalDailyLaborCost(input.manpower, input.crew, input.dailyWage, input.isGlobalLabor);
	const labor = days * dailyLabor;
	const equipment = days * num(input.equipmentRate) + num(input.equipmentOther);
	const consumable = prepCost + num(input.consumable);
	const subtotal = material + labor + equipment + consumable;

	return {
		material,
		labor,
		equipment,
		consumable,
		subtotal,
		meta: {
			days,
			area,
			totalCrew,
			dailyLabor,
			prodFactor,
			effectiveProd: Math.round(baseProd * prodFactor),
			prepCost,
			layers: layerDetails
		}
	};
}

export function calcItem(serviceType: string, inputs: any = {}): CostBreakdown {
	switch (serviceType) {
		case 'sandblasting':
			return calcSandblasting(inputs);
		case 'painting':
			return calcPainting(inputs);
		case 'floor_coating':
			return calcFloorCoating(inputs);
		default:
			return { material: 0, labor: 0, equipment: 0, consumable: 0, subtotal: 0, meta: {} };
	}
}

export interface QuotationTotals {
	directTotal: number;
	totalArea: number;
	mobilisasi: number;
	scaffolding: number;
	safety: number;
	overhead: number;
	margin: number;
	komisi: number;
	beforeTax: number;
	discount: number;
	dpp: number;
	ppnPct: number;
	ppn: number;
	grandTotal: number;
	pricePerM2: number;
}

export function calcQuotationTotals(items: any[] = [], header: any = {}): QuotationTotals {
	const directTotal = items.reduce((s, it) => s + num(it.subtotal), 0);
	const totalArea = items.reduce((s, it) => s + num(it.area) * num(it.qty, 1), 0);

	const mobilisasi = num(header.mobilisasi_amount);
	const scaffolding = num(header.scaffolding_amount);
	const safety = num(header.safety_amount);
	const komisi = num(header.komisi_amount);

	const baseAddon = directTotal + mobilisasi + scaffolding + safety;
	const overhead = baseAddon * (num(header.overhead_pct) / 100);
	const afterOverhead = baseAddon + overhead;
	const margin = afterOverhead * (num(header.margin_pct) / 100);
	const beforeTax = afterOverhead + margin + komisi;

	const discount = num(header.discount_amount);
	const dpp = Math.max(0, beforeTax - discount);
	const ppnPct = header.ppn_enabled ? num(header.ppn_pct, 11) : 0;
	const ppn = dpp * (ppnPct / 100);
	const grandTotal = dpp + ppn;
	const pricePerM2 = totalArea > 0 ? grandTotal / totalArea : 0;

	return {
		directTotal,
		totalArea,
		mobilisasi,
		scaffolding,
		safety,
		overhead,
		margin,
		komisi,
		beforeTax,
		discount,
		dpp,
		ppnPct,
		ppn,
		grandTotal,
		pricePerM2
	};
}
