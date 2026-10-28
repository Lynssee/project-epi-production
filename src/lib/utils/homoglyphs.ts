// Peta lipat karakter Sirilik & Yunani yang identik secara visual dengan Latin,
// ke padanan Latin-nya. Terbatas pada huruf yang benar-benar rawan tertukar saat
// salin-tempel (lihat Rencana_Implementasi_Pertajam_Search_v3.pdf §5.3, M3).
// Port identik dari repo admin: src/lib/utils/homoglyphs.js — jaga tetap sinkron.
export const HOMOGLYPH_FOLD: Record<string, string> = {
	// Sirilik uppercase -> Latin
	А: 'A', В: 'B', Е: 'E', З: '3', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P',
	С: 'C', Т: 'T', У: 'Y', Х: 'X', Ѕ: 'S', І: 'I', Ј: 'J',
	// Sirilik lowercase -> Latin
	а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p',
	с: 'c', т: 't', у: 'y', х: 'x', ѕ: 's', і: 'i', ј: 'j',
	// Yunani -> Latin
	Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N',
	Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
	α: 'a', β: 'b', ο: 'o', ρ: 'p', χ: 'x', υ: 'y', ι: 'i', κ: 'k', ν: 'v'
};

// Rentang blok Sirilik + Yunani, dipakai untuk membatasi penggantian karakter
// hanya pada huruf-huruf itu (tidak menyentuh aksen Latin lain).
export const HOMOGLYPH_RANGE = /[Ͱ-ϿЀ-ӿ]/g;

export function foldHomoglyphs(s: unknown): string {
	if (s == null) return '';
	return String(s).replace(HOMOGLYPH_RANGE, (ch) => HOMOGLYPH_FOLD[ch] ?? ch);
}
