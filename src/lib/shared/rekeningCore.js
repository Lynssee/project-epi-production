/**
 * rekeningCore — logika murni normalisasi rekening & nama penerima dana.
 *
 * Fase 1 rencana "Penajaman Penerima Dana & Track Record v2 (TAJAM)".
 *
 * ATURAN: modul ini WAJIB pure & aman-klien.
 * - Tidak boleh import Directus / fetch / env / fs.
 * - Dipakai bersama oleh gate server erp DAN kembarannya di project-epi (paritas).
 * - Levenshtein di-inline (bukan package) supaya bisa disalin apa adanya ke project-epi
 *   tanpa menambah dependensi di kedua repo.
 */

// ---------------------------------------------------------------------------
// Daftar bank baku bawaan. Sumber kebenaran runtime = app_settings
// (module `finance_rekening`, key `bank.daftar`). Ini hanya fallback bila
// setelan belum di-seed / tidak terjangkau.
// ---------------------------------------------------------------------------
export const DEFAULT_BANK_DAFTAR = [
	{ kode: 'BCA', label: 'BCA', alias: ['bank central asia', 'b c a', 'bca digital', 'blu', 'blu by bca'] },
	{ kode: 'BRI', label: 'BRI', alias: ['bank rakyat indonesia', 'b r i', 'briva', 'bri syariah'] },
	{ kode: 'BNI', label: 'BNI', alias: ['bank negara indonesia', 'b n i', 'bni syariah'] },
	{ kode: 'MANDIRI', label: 'Mandiri', alias: ['bank mandiri', 'mandiiri', 'mandri', 'mandiri syariah', 'livin'] },
	{ kode: 'BSI', label: 'BSI', alias: ['bank syariah indonesia', 'b s i', 'bank syariah'] },
	{ kode: 'BTN', label: 'BTN', alias: ['bank tabungan negara'] },
	{ kode: 'CIMB', label: 'CIMB Niaga', alias: ['cimb niaga', 'niaga', 'octo'] },
	{ kode: 'PERMATA', label: 'Permata', alias: ['bank permata', 'permata bank'] },
	{ kode: 'DANAMON', label: 'Danamon', alias: ['bank danamon'] },
	{ kode: 'BTPN', label: 'BTPN', alias: ['bank btpn', 'jenius'] },
	{ kode: 'MEGA', label: 'Bank Mega', alias: ['bank mega'] },
	{ kode: 'OCBC', label: 'OCBC', alias: ['ocbc nisp', 'nisp'] },
	{ kode: 'PANIN', label: 'Panin', alias: ['bank panin', 'panin bank'] },
	{ kode: 'MAYBANK', label: 'Maybank', alias: ['bank maybank', 'maybank indonesia'] },
	{ kode: 'SEABANK', label: 'SeaBank', alias: ['sea bank', 'seabank', 'sebank', 'sea bank indonesia'] },
	{ kode: 'JAGO', label: 'Bank Jago', alias: ['jago', 'bank jago syariah'] },
	{ kode: 'NEO', label: 'Bank Neo Commerce', alias: ['neo commerce', 'bnc', 'neobank'] },
	{ kode: 'MUAMALAT', label: 'Muamalat', alias: ['bank muamalat'] },
	{ kode: 'SINARMAS', label: 'Sinarmas', alias: ['bank sinarmas'] },
	{ kode: 'BUKOPIN', label: 'Bukopin', alias: ['bank bukopin', 'kb bukopin', 'kb bank'] },
	{ kode: 'DBS', label: 'DBS', alias: ['dbs indonesia', 'digibank'] },
	{ kode: 'HSBC', label: 'HSBC', alias: ['hsbc indonesia'] },
	{ kode: 'BJB', label: 'Bank BJB', alias: ['bjb', 'bank jabar banten'] },
	{ kode: 'LAINNYA', label: 'Lainnya', alias: [] }
];

// Pola bawaan deteksi Tagihan / Virtual Account / e-wallet.
// Sumber kebenaran runtime = app_settings key `tagihan.pola`.
export const DEFAULT_TAGIHAN_POLA =
	'virtual account|virtual|v\\.a\\.|\\bva\\b|briva|billing|biling|kode\\s*bayar|kode\\s*bill|shopee\\s*pay|shopeepay|gopay|\\bovo\\b|link\\s*aja|linkaja|\\bdana\\b|e-?wallet|e-?money|\\bpln\\b|indihome|\\bbpjs\\b|pajak|penerimaan negara|mpn|djp';

/**
 * Hanya digit. `null`/`undefined`/format kotor → string digit saja.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeRekening(raw) {
	return String(raw ?? '').replace(/\D+/g, '');
}

/**
 * Validasi bentuk nomor rekening (bukan validasi ke bank).
 * @param {unknown} raw
 * @returns {{ ok: boolean, norm: string, alasan: string|null }}
 */
export function validateRekeningShape(raw) {
	const norm = normalizeRekening(raw);
	if (!norm) return { ok: false, norm, alasan: 'kosong' };
	if (norm.length < 8) return { ok: false, norm, alasan: 'terlalu pendek (<8 digit)' };
	if (norm.length > 16) return { ok: false, norm, alasan: 'terlalu panjang (>16 digit)' };
	return { ok: true, norm, alasan: null };
}

/**
 * @param {unknown} s
 * @returns {string}
 */
function stripBankNoise(s) {
	return String(s ?? '')
		.toLowerCase()
		.replace(/\bbank\b/g, ' ')
		.replace(/\bpt\b|\btbk\b|\bpersero\b/g, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

/**
 * Petakan teks bank bebas → kode bank baku.
 * @param {unknown} raw teks bank apa adanya dari PA / master
 * @param {Array<{kode:string,label:string,alias?:string[]}>} [daftar] daftar bank; default bawaan
 * @returns {{ kode: string, label: string, cocok: 'kode'|'alias'|'awalan'|'tidak' }}
 */
export function resolveBank(raw, daftar = DEFAULT_BANK_DAFTAR) {
	const list = Array.isArray(daftar) && daftar.length ? daftar : DEFAULT_BANK_DAFTAR;
	const lainnya = list.find((b) => b.kode === 'LAINNYA') || { kode: 'LAINNYA', label: 'Lainnya' };
	const s = stripBankNoise(raw);
	if (!s) return { kode: lainnya.kode, label: lainnya.label, cocok: 'tidak' };
	const tokens = s.split(' ').filter(Boolean);

	// 1. cocok kode / label persis
	for (const b of list) {
		if (b.kode === 'LAINNYA') continue;
		if (s === b.kode.toLowerCase() || s === stripBankNoise(b.label)) {
			return { kode: b.kode, label: b.label, cocok: 'kode' };
		}
	}
	// 2. cocok alias — hati-hati substring pendek (mis. alias "kb" jangan cocok ke "akbar")
	for (const b of list) {
		if (b.kode === 'LAINNYA') continue;
		const aliases = [b.kode.toLowerCase(), stripBankNoise(b.label), ...(b.alias || []).map(stripBankNoise)].filter(Boolean);
		for (const a of aliases) {
			const cocok =
				s === a ||
				// alias satu kata → harus == salah satu token utuh (mis. "mandiri" di "mandiri kcp bekasi")
				(!a.includes(' ') && tokens.includes(a)) ||
				// alias frasa (multi-kata) → boleh substring (mis. "sea bank", "b c a")
				(a.includes(' ') && s.includes(a)) ||
				// input lebih pendek dari alias & cukup panjang (mis. "niaga" ⊂ "cimb niaga")
				(s.length >= 4 && a.includes(s));
			if (cocok) return { kode: b.kode, label: b.label, cocok: 'alias' };
		}
	}
	return { kode: lainnya.kode, label: lainnya.label, cocok: 'tidak' };
}

/**
 * Deteksi Tagihan / VA / e-wallet dari gabungan teks bank + nama.
 * @param {unknown} bank
 * @param {unknown} nama
 * @param {string|RegExp} [pola] pola regex (string atau RegExp); default bawaan
 * @returns {boolean}
 */
export function isTagihan(bank, nama, pola = DEFAULT_TAGIHAN_POLA) {
	const hay = `${bank ?? ''} ${nama ?? ''}`.toLowerCase();
	if (!hay.trim()) return false;
	let re;
	try {
		re = pola instanceof RegExp ? pola : new RegExp(String(pola), 'i');
	} catch {
		re = new RegExp(DEFAULT_TAGIHAN_POLA, 'i');
	}
	return re.test(hay);
}

/**
 * Normalisasi nama entitas untuk perbandingan.
 * @param {unknown} s
 * @returns {string}
 */
export function normalizeNama(s) {
	return String(s ?? '')
		.toLowerCase()
		.replace(/\b(pt|cv|tbk|persero|bapak|bpk|ibu|sdr|sdri|mr|mrs|the)\b/g, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

/**
 * Levenshtein distance (iteratif, satu baris buffer).
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number}
 */
export function levenshtein(a, b) {
	const sa = String(a ?? '');
	const sb = String(b ?? '');
	if (sa === sb) return 0;
	if (!sa.length) return sb.length;
	if (!sb.length) return sa.length;
	let prev = new Array(sb.length + 1);
	for (let j = 0; j <= sb.length; j++) prev[j] = j;
	for (let i = 1; i <= sa.length; i++) {
		let cur = [i];
		for (let j = 1; j <= sb.length; j++) {
			const cost = sa.charCodeAt(i - 1) === sb.charCodeAt(j - 1) ? 0 : 1;
			cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
		}
		prev = cur;
	}
	return prev[sb.length];
}

/**
 * Rasio kemiripan 0..1 berbasis Levenshtein pada nama ternormalisasi.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number}
 */
export function skorMiripNama(a, b) {
	const x = normalizeNama(a);
	const y = normalizeNama(b);
	if (!x || !y) return 0;
	if (x === y) return 1;
	const maxLen = Math.max(x.length, y.length);
	return 1 - levenshtein(x, y) / maxLen;
}

/**
 * Apakah dua nama "mirip" (varian ejaan / typo orang yang sama)?
 * Konservatif: butuh nama cukup panjang & ambang tinggi, ATAU salah satu memuat lainnya utuh.
 * @param {unknown} a
 * @param {unknown} b
 * @param {number} [ambang] rasio minimum (default 0.82)
 * @returns {boolean}
 */
export function namaMirip(a, b, ambang = 0.82) {
	const x = normalizeNama(a);
	const y = normalizeNama(b);
	if (!x || !y || x.length < 4 || y.length < 4) return false;
	if (x === y) return true;
	// Subset (satu memuat lainnya utuh) HANYA dipakai untuk nama lengkap (>=8 char
	// ternormalisasi) — nama pendek/satu kata ("PUTRI", "BUDI") terlalu umum dan jadi
	// substring banyak nama lain (mis. "PUTRI" ⊂ "Putri Nadya Salsabila" — orang berbeda).
	if (Math.min(x.length, y.length) >= 8 && (x.includes(y) || y.includes(x))) return true;
	return skorMiripNama(x, y) >= ambang;
}
