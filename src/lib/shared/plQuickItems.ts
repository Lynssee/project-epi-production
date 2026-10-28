// PRJ-26 — chip "barang cepat" Packing List: dari setelan per jenis pekerjaan + "paling sering diminta proyek ini".
// Dulu 8 barang tetap di kode (ubah = deploy). Sekarang: setelan project.pl.quick_items { "<jenis_project>": [chip…], "*": [chip…] };
// tanpa setelan → DEFAULT_QUICK_ITEMS (perilaku lama, tidak berubah). Fungsi MURNI.

export interface QuickChip {
	name: string;
	category: string;
	unit: string;
}
export type QuickItemsSetting = Record<string, QuickChip[]>;

export const DEFAULT_QUICK_ITEMS: QuickChip[] = [
	{ name: 'Kuas Roll 4 Inch', category: 'packing_consumable', unit: 'Pcs' },
	{ name: 'Masking Tape 2 Inch', category: 'packing_consumable', unit: 'Roll' },
	{ name: 'Majun Katun Super', category: 'packing_consumable', unit: 'Kg' },
	{ name: 'Sarung Tangan Karet (Latex)', category: 'packing_safety', unit: 'Pcs' },
	{ name: 'Kacamata Safety Clear', category: 'packing_safety', unit: 'Pcs' },
	{ name: 'Thinner Epoxy High Gloss', category: 'packing_supplier', unit: 'Liter' },
	{ name: 'Amplas Lembar No. 80', category: 'packing_consumable', unit: 'Lembar' },
	{ name: 'Helm Safety Putih + Tali Dagu', category: 'packing_safety', unit: 'Pcs' }
];

const key = (s: unknown) => String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
const valid = (c: any): c is QuickChip => !!c && typeof c.name === 'string' && c.name.trim() !== '' && typeof c.category === 'string' && typeof c.unit === 'string';

/** Chip untuk jenis pekerjaan tertentu: setelan jenis itu → setelan "*" → default kode. Entri rusak dibuang. */
export function chipsForJenis(setting: unknown, jenisProject: string | null | undefined): QuickChip[] {
	const s = setting && typeof setting === 'object' ? (setting as Record<string, unknown>) : {};
	const byKey = new Map(Object.entries(s).map(([k, v]) => [key(k), v]));
	const pick = (k: string) => {
		const arr = byKey.get(key(k));
		return Array.isArray(arr) ? arr.filter(valid) : [];
	};
	const specific = jenisProject ? pick(jenisProject) : [];
	if (specific.length) return specific;
	const star = pick('*');
	return star.length ? star : DEFAULT_QUICK_ITEMS;
}

/** Barang yang paling sering diminta (riwayat PL proyek): hitung per nama (huruf kecil), ambil n teratas. */
export function topRequested(rows: Array<{ material_name?: string | null; budget_category?: string | null; unit?: string | null }>, n = 5): QuickChip[] {
	const m = new Map<string, { count: number; chip: QuickChip }>();
	for (const r of rows || []) {
		const name = String(r?.material_name ?? '').trim();
		if (!name || !r.budget_category) continue;
		const k = key(name);
		const cur = m.get(k);
		if (cur) cur.count++;
		else m.set(k, { count: 1, chip: { name, category: String(r.budget_category), unit: String(r.unit ?? '') } });
	}
	return [...m.values()].filter((x) => x.count >= 2).sort((a, b) => b.count - a.count || a.chip.name.localeCompare(b.chip.name)).slice(0, n).map((x) => x.chip);
}

/** Gabungan: yang sering diminta dulu, lalu chip per jenis; duplikat nama dibuang. */
export function mergeChips(frequent: QuickChip[], base: QuickChip[], max = 12): QuickChip[] {
	const seen = new Set<string>();
	const out: QuickChip[] = [];
	for (const c of [...frequent, ...base]) {
		const k = key(c.name);
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(c);
		if (out.length >= max) break;
	}
	return out;
}
