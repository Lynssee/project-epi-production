// PRJ-26 — penebak kategori barang Packing List dari nama. Dulu `lower.includes('cat')` (substring) sehingga
// "Catridge printer" / "Locator" tertebak Material Supplier. Sekarang KATA UTUH (batas kata), urutan prioritas tetap.
// Daftar kata kunci adalah default; bisa diganti lewat setelan project.pl.category_keywords (peta kategori → kata).

export type PlCategoryKeywords = Record<string, string[]>;

export const DEFAULT_PL_CATEGORY_KEYWORDS: PlCategoryKeywords = {
	packing_supplier: ['cat', 'thinner', 'primer', 'epoxy', 'hardener'],
	packing_consumable: ['kuas', 'amplas', 'majun', 'tape', 'baut', 'mata gerinda'],
	packing_safety: ['helm', 'rompi', 'sarung tangan', 'kacamata', 'masker', 'harness', 'safety'],
	packing_sewa_alat: ['genset', 'kompresor', 'scaffold', 'mesin', 'molen']
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function hasWord(text: string, word: string): boolean {
	return new RegExp(`(?:^|[^a-z0-9])${escapeRe(word.toLowerCase())}(?:$|[^a-z0-9])`).test(text);
}

/** Kembalikan kategori PL yang cocok (kata utuh, urutan peta = prioritas) atau null bila tidak yakin. */
export function guessPlCategory(name: string, keywords: PlCategoryKeywords = DEFAULT_PL_CATEGORY_KEYWORDS): string | null {
	const text = String(name || '').toLowerCase();
	if (!text.trim()) return null;
	for (const [category, words] of Object.entries(keywords)) {
		if (words.some((w) => hasWord(text, w))) return category;
	}
	return null;
}
