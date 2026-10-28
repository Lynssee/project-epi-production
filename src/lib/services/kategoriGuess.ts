// src/lib/services/kategoriGuess.ts
// Rekomendasi §6.8 — tebak kategori_belanja dari teks keterangan pengajuan (pencocokan kata
// kunci sederhana, TANPA AI). Menyerang masalah "70,7% belanja masuk kategori Operasional"
// dari hulu. Hanya menyarankan; user tetap memilih.
//
// Fase 4 (Pos Keuangan v2 TAJAM) §5 F4.2 — dua bug ditemukan di audit Fase 0 (Fase2.2):
// aturan `safety` & `consumable` menunjuk kode yang TIDAK ADA di budget_category_config
// (kode sah: `hse_apd`; `consumable` baru dibuat sbg baris kategori tersendiri di F4),
// jadi kedua aturan itu TIDAK PERNAH cocok sejak awal (guessKategoriBelanja mem-filter
// hasil ke allowedKodes, yang selalu berasal dari budget_category_config live).

interface KwRule {
	kode: string;
	kw: RegExp;
}

// Urutan = prioritas (spesifik dulu). `kode` harus cocok dgn budget_category_config.kode.
// Dipakai sbg FALLBACK bila kategori yang bersangkutan belum punya clue_keywords terisi
// di Directus (lihat buildDynamicRules di bawah — itu yang dicek LEBIH DULU).
const RULES: KwRule[] = [
	{ kode: 'bbm_transport', kw: /\b(bbm|solar|pertalite|pertamax|bensin|dexlite|e-?tol+|tol|parkir|ongkos\s*jalan|transport|angkut|kurir|ekspedisi)\b/i },
	{ kode: 'gaji_manpower', kw: /\b(upah|gaji\s*(harian|borongan)?|manpower|tukang|helper|kenek|mandor|tenaga\s*kerja|borongan\s*orang)\b/i },
	{ kode: 'sewa_alat', kw: /\b(sewa|rental|rent(al)?)\s*(alat|scaffolding|perancah|genset|kompresor|mesin|mobil|pickup|crane|forklift)?\b/i },
	{ kode: 'material_supplier', kw: /\b(cat|epoxy|epoksi|thinner|hardener|primer|coating|dempul|besi|plat|pipa|semen|pasir|kawat|elektroda|amplas|kuas|roller|material|bahan)\b/i },
	{ kode: 'subkon_jasa', kw: /\b(subkon|sub\s*kontraktor|jasa\s*(pihak\s*ketiga|luar)?|vendor\s*jasa|borongan\s*pekerjaan)\b/i },
	// Fase 4 F4.2 — diperbaiki dari 'safety' (kode yang tak pernah ada) ke 'hse_apd' (sah).
	{ kode: 'hse_apd', kw: /\b(apd|safety|helm|kacamata|sarung\s*tangan|sepatu\s*safety|masker|body\s*harness|rambu|p3k|k3)\b/i },
	{ kode: 'consumable', kw: /\b(consumable|majun|lakban|isolasi|baterai|lampu|kabel\s*ties|sabun|tissue)\b/i },
	{ kode: 'hr_ga_atk', kw: /\b(atk|alat\s*tulis|kertas|tinta|printer|fotocopy|fotokopi|materai)\b/i }
];

/** Escape karakter khusus regex dalam satu kata kunci mentah dari Directus. */
function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fase 4 F4.2 — bangun aturan dari `clue_keywords` LIVE budget_category_config (bisa
 * dikoreksi Finance/Admin lewat UI tanpa deploy), bukan lagi murni hardcode. Kategori
 * tanpa clue_keywords terisi tidak menghasilkan aturan di sini — RULES di atas jadi
 * fallback-nya (lihat guessKategoriBelanja).
 */
function buildDynamicRules(categories: { kode: string; clue_keywords?: string[] | null }[]): KwRule[] {
	const rules: KwRule[] = [];
	for (const c of categories) {
		const kws = (c.clue_keywords || []).map((k) => String(k).trim()).filter(Boolean);
		if (kws.length === 0) continue;
		const pattern = kws.map(escapeRegExp).join('|');
		rules.push({ kode: c.kode, kw: new RegExp(`\\b(${pattern})\\b`, 'i') });
	}
	return rules;
}

/**
 * @param text - gabungan tujuan_pengajuan + keterangan item
 * @param allowedKodes - daftar kode kategori yang tersedia (dari budget_category_config)
 * @param categories - baris budget_category_config live (opsional) — dipakai membangun
 *   aturan dari clue_keywords terlebih dahulu sebelum jatuh ke RULES hardcode di atas.
 * @returns kode kategori tersarankan, atau null
 */
export function guessKategoriBelanja(
	text: string,
	allowedKodes: string[] = [],
	categories: { kode: string; clue_keywords?: string[] | null }[] = []
): string | null {
	const t = String(text || '').toLowerCase();
	if (t.trim().length < 3) return null;
	const allowed = new Set(allowedKodes);

	const dynamicRules = buildDynamicRules(categories);
	for (const r of dynamicRules) {
		if (r.kw.test(t) && (allowed.size === 0 || allowed.has(r.kode))) return r.kode;
	}

	for (const r of RULES) {
		if (r.kw.test(t) && (allowed.size === 0 || allowed.has(r.kode))) return r.kode;
	}
	return null;
}
