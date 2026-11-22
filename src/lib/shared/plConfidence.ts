// @ts-nocheck
// SALINAN KONTRAK dari erp-epi/src/lib/utils/plConfidence.js (Rencana Keyakinan Permintaan PL, sinkron 12 Nov 2026).
// JANGAN diedit di sini: ubah di erp-epi lalu salin ulang. Paritas isi dijaga tes kontrak lintas repo
// erp-epi/src/lib/server/gates/plCoverage.crossRepoContract.test.js (gagal bila kedua salinan menyimpang).
// '@ts-nocheck' disengaja: file ini JS murni yang identik dengan sisi admin; tipe tidak boleh membuatnya berbeda.
// src/lib/utils/plConfidence.js
// Modul MURNI (tanpa Directus / DOM). Skor Keyakinan Permintaan Packing List proyek (Rencana "Keyakinan Permintaan PL", Fase 1).
// Skor TIDAK menciptakan angka baru: ia merangkum temuan evaluator rasionalitas yang sudah ada
// (materialCoverageEngine: coverage m², kuota RAB, run-rate, stok site) menjadi satu lencana yang bisa dibaca dalam 10 detik.
//
// Tingkat:
//   green   — sudah dinilai terhadap luasan (m²) dan tidak ada temuan.
//   yellow  — ada temuan (qty melebihi plafon/kuota, material di luar RAB, stok site masih cukup). Leader wajib beri alasan terstruktur.
//   red     — melebihi plafon ≥ ambang ekstrem (pkl_coverage.extreme_alert_pct). Tertahan sampai dikoreksi / override berwenang.
//   unrated — TIDAK DAPAT DINILAI (luasan proyek kosong / tidak ada cat-coating terpetakan). Sengaja BUKAN hijau:
//             hijau tanpa dasar hitungan memberi rasa aman palsu (doktrin D2: data kurang ≠ lolos).
// Null-safe: semua input boleh null/undefined.

export const CONFIDENCE_LEVELS = Object.freeze(['green', 'yellow', 'red', 'unrated']);

export const CONFIDENCE_META = Object.freeze({
  green: { label: 'Hijau', icon: '🟢', short: 'Wajar', desc: 'Sudah dinilai terhadap luasan proyek dan tidak ada temuan.' },
  yellow: { label: 'Kuning', icon: '🟡', short: 'Perlu alasan', desc: 'Ada temuan rasionalitas. Leader wajib mengisi alasan; Inventory Manager meninjau sebelum menyetujui.' },
  red: { label: 'Merah', icon: '🔴', short: 'Tertahan', desc: 'Melebihi plafon jauh di atas batas wajar. Koreksi qty atau minta override pihak berwenang.' },
  unrated: { label: 'Belum dinilai', icon: '⚪', short: 'Data kurang', desc: 'Data dasar belum cukup (mis. luasan proyek kosong). Ini BUKAN berarti aman.' }
});

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const evaluated = (r) => !!r && r.status !== 'not_applicable' && r.status !== undefined && (num(r.evaluatedCount) > 0 || r.status === 'failed' || r.status === 'passed');

/**
 * @typedef {{status?:string, overCount?:number, evaluatedCount?:number, maxOverPct?:number, flaggedCount?:number, holdCount?:number}|null|undefined} CheckResult
 * @param {{
 *   area?: {areaM2:number, source?:string}|null,
 *   cov?: CheckResult, rab?: CheckResult, unregistered?: CheckResult, rr?: CheckResult, ss?: CheckResult
 * }|null} findings  hasil evaluateContextFindings() + c.area (server) atau hasil evaluator klien (lapangan)
 * @param {{extreme_alert_pct?:number}|null} [settings]  pkl_coverage.* (extreme_alert_pct 0 = skor merah nonaktif)
 * @returns {{
 *   level:'green'|'yellow'|'red'|'unrated', reasons:Array<{code:string, severity:'red'|'yellow'|'info', gate_key:string|null, text:string, fix:string}>,
 *   needsReason:boolean, evaluatedChecks:string[], maxOverPct:number
 * }}
 */
export function computeConfidence(findings, settings) {
  const f = findings || {};
  const extreme = num(settings?.extreme_alert_pct);
  const reasons = [];

  const covOver = num(f.cov?.overCount);
  const rabOver = num(f.rab?.overCount);
  const rrOver = num(f.rr?.overCount);
  const unreg = num(f.unregistered?.flaggedCount);
  const hold = num(f.ss?.holdCount);
  const maxOverPct = Math.max(num(f.cov?.maxOverPct), num(f.rab?.maxOverPct), num(f.rr?.maxOverPct));

  const evaluatedChecks = [];
  if (f.area && evaluated(f.cov)) evaluatedChecks.push('coverage');
  if (evaluated(f.rab) || evaluated(f.unregistered)) evaluatedChecks.push('rab');
  if (f.area && evaluated(f.rr)) evaluatedChecks.push('runrate');
  if (evaluated(f.ss)) evaluatedChecks.push('siteStock');

  if (covOver > 0) reasons.push({ code: 'coverage_over', severity: 'yellow', gate_key: 'G_PKL_COVERAGE_M2', text: `${covOver} item melebihi kebutuhan wajar untuk luasan proyek.`, fix: 'Turunkan qty ke saran maksimal, atau perbaiki luasan di Charter bila datanya salah.' });
  if (rabOver > 0) reasons.push({ code: 'rab_over', severity: 'yellow', gate_key: 'G_PKL_RAB_QUOTA', text: `${rabOver} item melewati kuota RAB.`, fix: 'Kurangi qty atau ajukan Addendum RAB.' });
  if (unreg > 0) reasons.push({ code: 'rab_unregistered', severity: 'yellow', gate_key: 'G_PKL_RAB_QUOTA', text: `${unreg} material utama tidak ada di RAB proyek.`, fix: 'Pakai produk yang ada di RAB atau ajukan penambahan RAB.' });
  if (rrOver > 0) reasons.push({ code: 'runrate_over', severity: 'yellow', gate_key: 'G_PKL_TIMELINE_RUNRATE', text: `${rrOver} item melebihi kebutuhan harian × buffer hari.`, fix: 'Pecah pengiriman per tahap kerja.' });
  if (hold > 0) reasons.push({ code: 'site_stock_hold', severity: 'yellow', gate_key: 'G_PKL_SITE_STOCK_RECON', text: `${hold} item masih tercukupi stok di site / pemakaian belum dilaporkan.`, fix: 'Catat pemakaian di Laporan Harian lalu ajukan ulang.' });

  const red = extreme > 0 && maxOverPct >= extreme;
  if (red) {
    reasons.unshift({ code: 'extreme_over', severity: 'red', gate_key: 'G_PKL_COVERAGE_M2', text: `Permintaan ${Math.round(maxOverPct)}% di atas plafon (ambang merah ${extreme}%).`, fix: 'Koreksi qty. Hanya pihak berwenang yang dapat melanjutkan tanpa koreksi.' });
  }

  if (!f.area) reasons.push({ code: 'no_area', severity: 'info', gate_key: null, text: 'Luasan proyek belum terisi / belum dipercaya, kewajaran m² belum bisa dinilai.', fix: 'Minta Admin mengisi Luasan di Charter proyek.' });
  else if (!evaluatedChecks.includes('coverage')) reasons.push({ code: 'no_mapped_material', severity: 'info', gate_key: null, text: 'Tidak ada cat/coating yang terpetakan ke standar daya sebar pada daftar ini.', fix: 'Normal untuk permintaan alat/consumable. Bila ada cat, pastikan nama memuat kode produk.' });

  const hasFinding = reasons.some((r) => r.severity !== 'info');
  let level;
  if (red) level = 'red';
  else if (hasFinding) level = 'yellow';
  else if (evaluatedChecks.includes('coverage')) level = 'green';
  else level = 'unrated';

  return { level, reasons, needsReason: level === 'yellow' || level === 'red', evaluatedChecks, maxOverPct: Math.round(maxOverPct) };
}

// ─────────────── Alasan terstruktur (Fase 1: G_PKL_ALASAN_TERSTRUKTUR) ───────────────
// Disimpan sebagai SATU baris bertag di packing_list.notes (tanpa kolom baru):
//   [ALASAN-KEYAKINAN|<kategori>] <catatan>
// Kategori = pilihan dari setelan pkl_coverage.confidence_reason_options (bukan teks bebas); catatan = penjelasan singkat.
const TAG_RE = /^\[ALASAN-KEYAKINAN\|([^\]\n]*)\][ \t]*(.*)$/m;

export function buildAlasanTag(kategori, catatan) {
  const k = String(kategori ?? '').replace(/[\]|\n\r]/g, ' ').trim();
  const c = String(catatan ?? '').replace(/[\n\r]+/g, ' ').trim();
  return `[ALASAN-KEYAKINAN|${k}] ${c}`.trim();
}

/** @returns {{kategori:string, catatan:string}|null} */
export function parseAlasanTag(notes) {
  const m = TAG_RE.exec(String(notes ?? ''));
  return m ? { kategori: m[1].trim(), catatan: (m[2] || '').trim() } : null;
}

/**
 * Bersihkan alasan yang datang dari klien (lapangan → payload approval). Mengembalikan null bila kategori/catatan kosong.
 * Batas panjang melindungi payload JSON dan tampilan; validasi isi (kategori ∈ daftar, panjang minimal) tetap oleh validateAlasan().
 * @returns {{kategori:string, catatan:string}|null}
 */
export function sanitizeAlasanInput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kategori = String(raw.kategori ?? '').replace(/[\r\n\]|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  const catatan = String(raw.catatan ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  return kategori && catatan ? { kategori, catatan } : null;
}

/** Ganti/menambah baris alasan pada teks notes tanpa merusak catatan lain. */
export function upsertAlasanTag(notes, kategori, catatan) {
  const tag = buildAlasanTag(kategori, catatan);
  const base = String(notes ?? '');
  if (TAG_RE.test(base)) return base.replace(TAG_RE, () => tag);
  return base.trim() ? `${base.trimEnd()}\n${tag}` : tag;
}

/** "A, B, C" → ['A','B','C'] (maks 12, tanpa duplikat); kosong ⇒ default bawaan. */
export function parseReasonOptions(raw, fallback = DEFAULT_REASON_OPTIONS) {
  const list = [...new Set(String(raw ?? '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean))].slice(0, 12);
  return list.length ? list : [...fallback];
}

export const DEFAULT_REASON_OPTIONS = Object.freeze([
  'Mobilisasi awal proyek',
  'Luasan bertambah / revisi area',
  'Pekerjaan perbaikan atau ulang lapis',
  'Hanya tersedia kemasan lebih besar',
  'Stok site habis tak terduga',
  'Lainnya (jelaskan)'
]);

/**
 * @param {{kategori?:string, catatan?:string}|null} alasan
 * @param {{minLen?:number, options?:string[]}} [cfg]
 * @returns {{ok:boolean, error:string}}
 */
export function validateAlasan(alasan, cfg = {}) {
  const minLen = Math.max(1, num(cfg.minLen) || 20);
  if (!alasan || !String(alasan.kategori || '').trim()) return { ok: false, error: 'Pilih kategori alasan.' };
  if (Array.isArray(cfg.options) && cfg.options.length && !cfg.options.includes(String(alasan.kategori).trim())) {
    return { ok: false, error: 'Kategori alasan tidak dikenal.' };
  }
  if (String(alasan.catatan || '').trim().length < minLen) return { ok: false, error: `Jelaskan alasan minimal ${minLen} karakter.` };
  return { ok: true, error: '' };
}
