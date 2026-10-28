// src/lib/shared/paintColorUtils.ts
// Utilitas pendeteksi dan penegakan spesifikasi warna material cat untuk Project EPI (Dashboard Lapangan)

/** Kata kunci standar untuk mendeteksi barang bertipe cat / pelapis yang membutuhkan warna. */
export const DEFAULT_MANDATORY_COLOR_KEYWORDS: readonly string[] = Object.freeze([
	'cat',
	'topcoat',
	'finish',
	'polyurethane',
	'foxa 955',
	'foxa955',
	'foxacoat',
	'epoxy topcoat',
	'alkyd',
	'enamel',
	'primer',
	'foxafloor',
	'ox - 9251',
	'ox-9251',
	'ox 9251',
	'9251',
	'ox - 902',
	'ox-902',
	'ox 902',
	'902'
]);

/** Kata kunci standar untuk cat pelapis bening / transparan (otomatis disarankan "Clear / Bening"). */
export const DEFAULT_CLEAR_KEYWORDS: readonly string[] = Object.freeze([
	'clear',
	'bening',
	'transparan',
	'9251',
	'ox - 9251',
	'ox-9251',
	'ox 9251'
]);

/** Kata kunci barang pendukung / non-cat yang dikecualikan dari kewajiban warna. */
export const DEFAULT_EXEMPT_KEYWORDS: readonly string[] = Object.freeze([
	'thinner',
	'tiner',
	'pelarut',
	'talc',
	'talk',
	'pasir',
	'silica',
	'kuas',
	'roll',
	'cleaner',
	'solvent',
	'majun',
	'kain majun',
	'amplas',
	'tape',
	'lakban',
	'hardener',
	'katalis',
	'resin',
	'additive'
]);

const escapeRe = (s: string) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Cek apakah teks mengandung kata kunci tertentu.
 */
export function matchesKeyword(text: string, keyword: string): boolean {
	if (!text || !keyword) return false;
	const cleanText = text.toLowerCase();
	const cleanKw = keyword.toLowerCase();

	if (cleanKw.includes(' ') || cleanKw.includes('-')) {
		return cleanText.includes(cleanKw);
	}

	const re = new RegExp(`(?:^|[^a-z0-9])${escapeRe(cleanKw)}(?:$|[^a-z0-9])`, 'i');
	return re.test(cleanText);
}

/**
 * Normalisasi string warna, menghasilkan string bersih atau null jika kosong/hanya "-".
 */
export function cleanColor(color: string | null | undefined): string | null {
	if (color == null) return null;
	const trimmed = String(color).trim();
	if (!trimmed || trimmed === '-' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') {
		return null;
	}
	return trimmed;
}

/**
 * Cek apakah suatu item adalah material yang dikecualikan dari warna (misal thinner, pasir, talc).
 */
export function isExemptPaintItem(name: string, exemptKeywords = DEFAULT_EXEMPT_KEYWORDS): boolean {
	if (!name) return false;
	return exemptKeywords.some((kw) => matchesKeyword(name, kw));
}

/**
 * Cek apakah suatu cat adalah varian bening / Clear (seperti OX-9251).
 */
export function isClearPaint(name: string, clearKeywords = DEFAULT_CLEAR_KEYWORDS): boolean {
	if (!name) return false;
	return clearKeywords.some((kw) => matchesKeyword(name, kw));
}

/**
 * Menentukan apakah suatu item tergolong barang cat / coating yang membutuhkan spesifikasi warna.
 */
export function isPaintItem(
	name: string,
	opts: {
		category?: string;
		mandatoryKeywords?: readonly string[];
		exemptKeywords?: readonly string[];
	} = {}
): boolean {
	if (!name) return false;
	const exemptKws = opts.exemptKeywords || DEFAULT_EXEMPT_KEYWORDS;
	if (isExemptPaintItem(name, exemptKws)) return false;

	const mandatoryKws = opts.mandatoryKeywords || DEFAULT_MANDATORY_COLOR_KEYWORDS;
	const matchesName = mandatoryKws.some((kw) => matchesKeyword(name, kw));
	if (matchesName) return true;

	const cat = String(opts.category || '').toLowerCase();
	if ((cat === 'supplier' || cat === 'packing_supplier') && !isExemptPaintItem(name, exemptKws)) {
		return true;
	}

	return false;
}

/**
 * Dapatkan warna bawaan yang disarankan berdasarkan nama item (misal "Clear / Bening" untuk 9251).
 */
export function getDefaultPaintColor(name: string, opts: { clearKeywords?: readonly string[] } = {}): string {
	const clearKws = opts.clearKeywords || DEFAULT_CLEAR_KEYWORDS;
	if (isClearPaint(name, clearKws)) {
		return 'Clear / Bening';
	}
	return '';
}
