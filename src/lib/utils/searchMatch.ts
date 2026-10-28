// Mesin pencocokan pencarian bersama — dipakai di semua permukaan search lapangan.
// Lihat Rencana_Implementasi_Pertajam_Search_v3.pdf §5 untuk rancangan lengkap.
// Port identik dari repo admin: src/lib/utils/searchMatch.js — jaga tetap sinkron.
import { foldHomoglyphs } from './homoglyphs';

export function normalizeText(s: unknown): string {
	if (s == null) return '';
	return foldHomoglyphs(String(s).normalize('NFKC'))
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

// Versi ringan untuk data yang DISIMPAN (bukan dicocokkan): hanya NFKC +
// lipat homoglyph, tanpa lowercase/hapus tanda baca — casing & format asli
// tetap utuh. Dipakai saat create/update agar kontaminasi Sirilik (M3) tidak
// terus bertambah di data baru.
export function sanitizeText<T extends string | null | undefined>(s: T): T {
	if (s == null) return s;
	return foldHomoglyphs(String(s).normalize('NFKC')) as T;
}

export function tokenize(q: unknown): string[] {
	const normalized = normalizeText(q);
	if (!normalized) return [];
	return normalized.split(/\s+/).filter(Boolean);
}

// AND antar-token: setiap token harus muncul sebagai substring di blob.
export function matchTokens(blob: unknown, tokens: string[]): boolean {
	if (!tokens || !tokens.length) return true;
	const normalizedBlob = normalizeText(blob);
	return tokens.every((t) => normalizedBlob.includes(t));
}

// Gabungkan beberapa field jadi satu blob ternormalisasi untuk dicocokkan.
export function buildBlob(fields: unknown[]): string {
	return normalizeText(fields.filter(Boolean).join(' '));
}

// Cocokkan query mentah terhadap kumpulan field. AND antar-token, OR antar-field
// per token (satu token boleh cocok di field manapun).
export function matchQuery(query: unknown, fields: unknown[]): boolean {
	const tokens = tokenize(query);
	if (!tokens.length) return true;
	const blob = buildBlob(fields);
	return matchTokens(blob, tokens);
}

export interface HighlightSegment {
	text: string;
	match: boolean;
}

// Highlight token yang cocok pada teks asli (untuk tampilan hasil).
// Mengembalikan array segmen { text, match } agar UI bisa merender <mark>.
export function highlightTokens(text: unknown, tokens: string[]): HighlightSegment[] {
	const str = String(text ?? '');
	if (!tokens || !tokens.length) return [{ text: str, match: false }];

	const normalized = normalizeText(str);
	// Peta indeks karakter ternormalisasi -> indeks karakter asli sulit dijaga
	// presisi saat panjang berubah (mis. tanda baca dilipat jadi spasi), jadi
	// highlight dilakukan dengan regex case-insensitive langsung pada teks asli
	// untuk token yang murni alfanumerik tanpa homoglyph.
	const escaped = tokens
		.filter(Boolean)
		.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		.filter((t) => normalized.includes(t.toLowerCase()));
	if (!escaped.length) return [{ text: str, match: false }];

	const re = new RegExp(`(${escaped.join('|')})`, 'giu');
	const parts = str.split(re);
	return parts.map((part) => ({
		text: part,
		match: escaped.some((t) => part.toLowerCase() === t.toLowerCase())
	}));
}

// ── Kamus sinonim & singkatan operasional untuk memperkaya pencarian ──
export const SEARCH_SYNONYMS: Record<string, string[]> = {
	bpir: ['bpr', 'inspection', 'inspeksi', 'blasting', 'painting', 'dft', 'qc', 'mutu', 'pengujian', 'laporan'],
	bpr: ['bpir', 'inspection', 'inspeksi', 'dft', 'qc', 'blasting', 'painting'],
	pengujian: ['uji', 'test', 'testing', 'qa', 'qc', 'lab', 'inspeksi', 'inspection', 'itp', 'parameter'],
	uji: ['pengujian', 'test', 'testing', 'qa', 'qc', 'lab', 'parameter'],
	testing: ['pengujian', 'uji', 'test', 'qa', 'test case', 'tester'],
	test: ['pengujian', 'uji', 'testing', 'qa'],
	inspeksi: ['inspection', 'qc', 'bpir', 'rfi', 'itp', 'p2h', 'mutu', 'pengujian'],
	inspection: ['inspeksi', 'qc', 'bpir', 'rfi', 'itp', 'mutu', 'pengujian'],
	ga: ['general', 'affair', 'operasional', 'fasilitas', 'utilitas'],
	general: ['ga', 'affair', 'operasional'],
	affair: ['ga', 'general', 'operasional'],
	kios: ['kiosk', 'tablet', 'timbang'],
	kiosk: ['kios', 'tablet', 'timbang'],
	retur: ['return', 'pengembalian'],
	return: ['retur', 'pengembalian'],
	gudang: ['inventory', 'stok', 'warehouse', 'logistik'],
	stok: ['stock', 'inventory', 'gudang'],
	stock: ['stok', 'inventory', 'gudang'],
	inventory: ['gudang', 'stok', 'stock', 'warehouse', 'logistik', 'barang'],
	warehouse: ['gudang', 'inventory', 'stok'],
	logistik: ['gudang', 'inventory', 'pengiriman', 'distribusi'],
	karyawan: ['pegawai', 'hrd', 'staff', 'sdm', 'pekerja'],
	pegawai: ['karyawan', 'hrd', 'staff', 'sdm'],
	hrd: ['karyawan', 'pegawai', 'sdm', 'people', 'ess'],
	perbaikan: ['maintenance', 'wo', 'service', 'servis', 'bengkel'],
	servis: ['maintenance', 'perbaikan', 'service'],
	maintenance: ['perbaikan', 'servis', 'service', 'wo', 'bengkel', 'aset'],
	pembelian: ['procurement', 'po', 'pengadaan', 'pr', 'beli'],
	pengadaan: ['procurement', 'pembelian', 'po', 'vendor', 'supplier'],
	procurement: ['pembelian', 'pengadaan', 'po', 'pr', 'vendor'],
	penjualan: ['sales', 'so', 'crm', 'pelanggan', 'customer', 'jual'],
	sales: ['penjualan', 'so', 'crm', 'pelanggan', 'customer', 'omnichannel'],
	keuangan: ['finance', 'kas', 'petty', 'anggaran', 'rap', 'uang', 'biaya', 'invoice'],
	finance: ['keuangan', 'kas', 'anggaran', 'rap', 'biaya', 'invoice', 'pembukuan'],
	kas: ['kasbon', 'petty', 'cash', 'keuangan'],
	kasbon: ['kas', 'petty', 'cash', 'keuangan'],
	anggaran: ['budget', 'pengajuan', 'pa', 'rap', 'keuangan'],
	dokumen: ['arsip', 'doc', 'surat', 'katalog', 'file'],
	surat: ['dokumen', 'surat jalan', 'sj'],
	sj: ['surat jalan', 'pengiriman', 'delivery', 'logistik'],
	spk: ['perintah kerja', 'work order', 'wo', 'produksi'],
	wo: ['work order', 'perbaikan', 'maintenance', 'spk'],
	po: ['purchase order', 'pembelian', 'procurement'],
	so: ['sales order', 'penjualan', 'sales'],
	pr: ['purchase requisition', 'pengajuan pembelian'],
	pa: ['pengajuan anggaran', 'anggaran'],
	rfq: ['request for quotation', 'pengadaan', 'penawaran'],
	itp: ['inspection test plan', 'pengujian mutu', 'inspeksi material'],
	rfi: ['request for inspection', 'permohonan inspeksi'],
	ncr: ['non conformance report', 'cacat', 'komplain', 'reject'],
	dft: ['dry film thickness', 'ketebalan cat', 'mikron', 'bpir', 'qc'],
	csr: ['social responsibility', 'dampak sosial', 'donasi', 'sroi'],
	proyek: ['project', 'lapangan', 'site'],
	project: ['proyek', 'lapangan', 'site'],
	bengkel: ['workshop', 'ciketing', 'balaraja', 'maintenance'],
	workshop: ['bengkel', 'ciketing', 'balaraja', 'manufaktur'],
	'360': ['profil', 'knowledge', 'spesifikasi', 'spek', 'kartu', 'identitas'],
	profil: ['360', 'spesifikasi', 'spek', 'knowledge', 'kartu', 'identitas'],
	knowledge: ['360', 'profil', 'pengetahuan', 'sop', 'panduan'],
	spek: ['spesifikasi', '360', 'profil', 'standar'],
	spesifikasi: ['spek', '360', 'profil', 'standar'],
	equipment: ['alat', 'mesin', 'kendaraan', 'aset', 'unit'],
	alat: ['equipment', 'mesin', 'aset', 'unit'],
	mesin: ['equipment', 'alat', 'aset'],
	kendaraan: ['fleet', 'mobil', 'truk', 'equipment', 'driver'],
	fleet: ['kendaraan', 'mobil', 'truk', 'driver', 'pengiriman']
};

/**
 * Hitung jarak Levenshtein cepat untuk toleransi typo.
 */
export function levenshteinDistance(a: string, b: string): number {
	if (a === b) return 0;
	const la = a.length;
	const lb = b.length;
	if (!la) return lb;
	if (!lb) return la;

	let prev = new Array(lb + 1);
	for (let j = 0; j <= lb; j++) prev[j] = j;

	for (let i = 1; i <= la; i++) {
		const curr = new Array(lb + 1);
		curr[0] = i;
		const ca = a.charCodeAt(i - 1);
		for (let j = 1; j <= lb; j++) {
			const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
			curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
		}
		prev = curr;
	}
	return prev[lb];
}

/**
 * Cocokkan satu token terhadap daftar kata: exact, prefix, atau fuzzy (jarak 1-2).
 */
export function matchTokenAgainstWords(
	token: string,
	words: string[]
): { matched: boolean; isExact: boolean; isFuzzy: boolean } {
	if (!token || !words || !words.length) return { matched: false, isExact: false, isFuzzy: false };

	const tokenLen = token.length;
	// Toleransi typo:
	// <= 3 huruf: exact only (hindari false positive singkatan)
	// 4 - 6 huruf: maks jarak 1
	// >= 7 huruf: maks jarak 2
	const maxDist = tokenLen <= 3 ? 0 : tokenLen <= 6 ? 1 : 2;

	let isFuzzy = false;
	for (const w of words) {
		if (w === token || w.startsWith(token) || (tokenLen >= 3 && w.includes(token))) {
			return { matched: true, isExact: true, isFuzzy: false };
		}
		if (maxDist > 0 && Math.abs(w.length - tokenLen) <= maxDist) {
			const dist = levenshteinDistance(token, w);
			if (dist <= maxDist) {
				isFuzzy = true;
			}
		}
	}

	if (isFuzzy) {
		return { matched: true, isExact: false, isFuzzy: true };
	}

	return { matched: false, isExact: false, isFuzzy: false };
}

/**
 * Perluas array token dengan padanan sinonim & singkatan
 */
export function expandTokensWithSynonyms(tokens: string[]): string[] {
	if (!tokens || !tokens.length) return [];
	const expanded = new Set<string>(tokens);
	for (const token of tokens) {
		const norm = normalizeText(token);
		const synonyms = SEARCH_SYNONYMS[norm];
		if (synonyms) {
			for (const s of synonyms) {
				const sTokens = tokenize(s);
				for (const st of sTokens) expanded.add(st);
			}
		}
	}
	return Array.from(expanded);
}

export interface NavSearchEntry {
	title: string;
	parent?: string | null;
	keywords?: string;
	href: string;
}

/**
 * Skor relevansi navigasi menu / Command Palette
 */
export function scoreNavEntry(
	entry: NavSearchEntry,
	query: string,
	tokens: string[],
	_expandedTokens: string[]
): number {
	const q = normalizeText(query);
	if (!q) return 0;
	const title = normalizeText(entry.title || '');
	const parent = normalizeText(entry.parent || '');
	const keywords = normalizeText(entry.keywords || '');
	const href = normalizeText(entry.href || '');
	const fullBlob = `${parent} ${title} ${keywords} ${href}`;

	// 1. Exact match pada title
	if (title === q) return 100;
	// 2. Title diawali query
	if (title.startsWith(q)) return 85;
	// 3. Title mengandung query utuh
	if (title.includes(q)) return 70;
	// 4. Keywords mengandung query utuh
	if (keywords.includes(q)) return 60;
	// 5. Parent mengandung query utuh
	if (parent.includes(q)) return 50;

	if (!tokens || !tokens.length) return 0;

	// 6. Seluruh token asli cocok pada gabungan blob (verbatim AND antar-token)
	const allVerbatim = tokens.every((t) => fullBlob.includes(t));
	if (allVerbatim) {
		const inTitle = tokens.every((t) => title.includes(t));
		return inTitle ? 48 : 40;
	}

	// 7. Evaluasi pintar per-token (AND requirement dengan sinonim & fuzzy matching)
	const blobWords = tokenize(fullBlob);
	let exactMatches = 0;
	let synonymMatches = 0;
	let fuzzyMatches = 0;

	for (const token of tokens) {
		// A. Direct exact/prefix/fuzzy match
		const direct = matchTokenAgainstWords(token, blobWords);
		if (direct.matched) {
			if (direct.isExact) exactMatches++;
			else if (direct.isFuzzy) fuzzyMatches++;
			continue;
		}

		// B. Cek sinonim token
		const normToken = normalizeText(token);
		const synonyms = SEARCH_SYNONYMS[normToken] || [];
		let synMatched = false;
		for (const syn of synonyms) {
			const synNorm = normalizeText(syn);
			if (fullBlob.includes(synNorm)) {
				synMatched = true;
				break;
			}
			const synTokens = tokenize(syn);
			if (synTokens.length && synTokens.every((st) => fullBlob.includes(st))) {
				synMatched = true;
				break;
			}
		}

		if (synMatched) {
			synonymMatches++;
		}
	}

	const totalMatched = exactMatches + synonymMatches + fuzzyMatches;

	// Seluruh token berhasil dipenuhi (kombinasi exact, sinonim, atau fuzzy typo)
	if (totalMatched === tokens.length) {
		if (fuzzyMatches === 0 && synonymMatches > 0) {
			return 35; // Semua token cocok lewat sinonim/singkatan
		}
		if (fuzzyMatches > 0) {
			return 28; // Semua token cocok dengan toleransi typo (mis. "inentory 360")
		}
	}

	// Partial match: Hanya berlaku jika query terdiri dari 3 token atau lebih,
	// dan mayoritas token (>= 66%) cocok. Mencegah query 2 token seperti "inventory 360"
	// membanjiri hasil hanya karena token "inventory" cocok pada parent.
	if (tokens.length >= 3 && totalMatched / tokens.length >= 0.66) {
		return Math.round((totalMatched / tokens.length) * 15);
	}

	return 0;
}
