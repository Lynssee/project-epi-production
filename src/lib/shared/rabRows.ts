// PRJ-24 — mode "per baris RAP" di panel RAP vs Aktual: setiap baris RAP (barang/pos) dengan terpakai & sisa-nya, plus
// realisasi yang BELUM ditautkan ke baris RAP (rab_budget_id kosong). Fungsi murni.
import { isPackingCategory, normalizeRapCategoryKey } from './rapCategory';

const n = (v: any) => parseFloat(v) || 0;

export interface RabRow {
	id: number | string;
	label: string;
	bucket: string;
	rap: number;
	terpakai: number;
	sisa: number;
	pct: number | null; // terpakai / rap * 100
	over: boolean;
}

export interface RabRowsResult {
	rows: RabRow[];
	unlinkedActual: number;
	linkedActual: number;
}

/**
 * @param rabItems baris RAP (project_budgets) — header & packing_* dikeluarkan (K7)
 * @param perRab peta rab_budget_id → total realisasi tertaut
 * @param unlinkedActual total realisasi tanpa tautan baris RAP
 */
export function buildRabRows(rabItems: any[], perRab: Record<string, number>, unlinkedActual = 0): RabRowsResult {
	const rows: RabRow[] = [];
	let linkedActual = 0;
	for (const i of rabItems || []) {
		if (i?.is_category_header || isPackingCategory(i?.budget_category)) continue;
		const rap = n(i.planned_amount);
		const terpakai = n(perRab?.[String(i.id)]);
		linkedActual += terpakai;
		rows.push({
			id: i.id,
			label: String(i.material_name || i.description || i.category_label || `Pos #${i.id}`).trim(),
			bucket: normalizeRapCategoryKey(i.budget_category),
			rap,
			terpakai,
			sisa: rap - terpakai,
			pct: rap > 0 ? (terpakai / rap) * 100 : null,
			over: terpakai > rap + 0.5
		});
	}
	// Overrun paling parah dulu, lalu yang terbesar.
	rows.sort((a, b) => Number(b.over) - Number(a.over) || b.terpakai - a.terpakai || b.rap - a.rap);
	return { rows, unlinkedActual: n(unlinkedActual), linkedActual };
}
