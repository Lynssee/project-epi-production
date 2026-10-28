// PRJ-26 — master satuan tunggal untuk RAP / Packing List / aktualisasi. Dulu 3 daftar berbeda
// (RAP: m², Lbr, Titik; PL: M², Lembar, Galon; panel aktualisasi: tanpa Titik) sehingga barang yang sama tercatat
// dengan ejaan berbeda dan pencocokan RAP↔PL/stok meleset. `code` stabil, `label` tampilan, `aliases` ejaan lama.
// Default di kode; bisa diganti lewat setelan project.units (JSON [{code,label,aliases}]).
// ⚠️ Sinkron dengan erp-epi bila daftar ini berubah (RAB_UNITS di soRabApi.js memakai label yang sama).

export interface UnitDef {
	code: string;
	label: string;
	aliases: string[];
}

export const DEFAULT_UNITS: UnitDef[] = [
	{ code: 'kg', label: 'Kg', aliases: ['kilogram', 'kgs'] },
	{ code: 'ltr', label: 'Liter', aliases: ['ltr', 'l', 'lt', 'litre'] },
	{ code: 'pcs', label: 'Pcs', aliases: ['pc', 'buah', 'bh'] },
	{ code: 'unit', label: 'Unit', aliases: [] },
	{ code: 'set', label: 'Set', aliases: [] },
	{ code: 'btg', label: 'Batang', aliases: ['btg'] },
	{ code: 'lbr', label: 'Lembar', aliases: ['lbr', 'lembar', 'sheet'] },
	{ code: 'roll', label: 'Roll', aliases: ['rol', 'gulung'] },
	{ code: 'sak', label: 'Sak', aliases: ['zak'] },
	{ code: 'drum', label: 'Drum', aliases: [] },
	{ code: 'galon', label: 'Galon', aliases: ['gal'] },
	{ code: 'kaleng', label: 'Kaleng', aliases: ['klg', 'pail'] },
	{ code: 'ls', label: 'Ls', aliases: ['lumpsum', 'lump sum', 'lot'] },
	{ code: 'm', label: 'M', aliases: ['meter', 'mtr', 'm1', "m'"] },
	{ code: 'm2', label: 'M²', aliases: ['m²', 'm2', 'meter persegi', 'mtr2'] },
	{ code: 'm3', label: 'M³', aliases: ['m³', 'm3', 'meter kubik'] },
	{ code: 'box', label: 'Box', aliases: ['dus', 'kotak'] },
	{ code: 'titik', label: 'Titik', aliases: ['ttk'] },
	{ code: 'jam', label: 'Jam', aliases: [] },
	{ code: 'hari', label: 'Hari', aliases: ['hr'] },
	{ code: 'bulan', label: 'Bulan', aliases: ['bln'] },
	// Ditambahkan dari data nyata project_budgets.unit (Okt 2026): Ton 133, Lusin 118, Pasang 58, OH 20, Pack 4.
	{ code: 'ton', label: 'Ton', aliases: [] },
	{ code: 'lusin', label: 'Lusin', aliases: ['lsn'] },
	{ code: 'pasang', label: 'Pasang', aliases: ['psg'] },
	{ code: 'pack', label: 'Pack', aliases: ['pak', 'pck'] },
	{ code: 'oh', label: 'OH', aliases: ['orang hari', 'orang-hari'] }
];

const key = (s: unknown) => String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');

/** Cari definisi satuan dari ejaan apa pun (code / label / alias). */
export function findUnit(raw: unknown, units: UnitDef[] = DEFAULT_UNITS): UnitDef | null {
	const k = key(raw);
	if (!k) return null;
	return units.find((u) => key(u.code) === k || key(u.label) === k || u.aliases.some((a) => key(a) === k)) ?? null;
}

/** Label baku untuk ejaan apa pun; tak dikenal → null (pemanggil memutuskan, jangan ditebak). */
export function normalizeUnitLabel(raw: unknown, units: UnitDef[] = DEFAULT_UNITS): string | null {
	return findUnit(raw, units)?.label ?? null;
}

/** true bila dua ejaan menunjuk satuan yang sama (untuk pencocokan RAP↔PL). */
export function sameUnit(a: unknown, b: unknown, units: UnitDef[] = DEFAULT_UNITS): boolean {
	const ua = findUnit(a, units);
	const ub = findUnit(b, units);
	return !!ua && !!ub && ua.code === ub.code;
}

export const UNIT_LABELS: string[] = DEFAULT_UNITS.map((u) => u.label);

/**
 * Opsi <select> satuan: master + nilai tersimpan yang tak ada di master (data lama) supaya tidak tampil kosong / hilang
 * diam-diam saat form dibuka. Ejaan lama (mis. LITER, m²) tetap terlihat sampai dinormalisasi.
 */
export function unitOptionsFor(current: unknown, units: UnitDef[] = DEFAULT_UNITS): string[] {
	const labels = units.map((u) => u.label);
	const cur = String(current ?? '').trim();
	return !cur || labels.includes(cur) ? labels : [...labels, cur];
}
