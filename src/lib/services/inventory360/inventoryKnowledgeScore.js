// @ts-nocheck — modul murni berbagi dua repo (project-epi memakai checkJs strict); tipe dijaga lewat tes, bukan JSDoc penuh.
// src/lib/services/inventoryKnowledgeScore.js
// Inventory 360° Fase 2 — skor kelengkapan profil, syarat verifikasi, dan deteksi kedaluwarsa.
// Modul MURNI (tanpa import) — dipakai editor (live), service simpan (disimpan ke skor_kelengkapan), dan tes.
//
// Bentuk JSON profil (lihat catatan field di koleksi inventory_knowledge_profile):
//   panduan_beli : { wajib_cek[], hindari[], tier_merk{oem,premium,ekonomis}, tanda_palsu[], cross_ref_part_no[] }
//   panduan_pakai: { cara_pasang, interval_ganti{nilai,satuan}, tanda_harus_ganti[], kesalahan_umum[] }
//   decision_rules: { perbaiki_vs_ganti, substitusi_aman, kapan_eskalasi }
//   spec_baik    : [{ param, target, alasan }]      dipakai_pada: [{ group_id, nama, catatan }]
//   apd          : string[]                          spec_values : { [key]: nilai }

const txt = (v) => String(v ?? '').trim().length > 0;
const list = (v) => (Array.isArray(v) ? v.filter((x) => txt(typeof x === 'object' ? JSON.stringify(x) : x)) : []);
const num = (v) => Number(v);

/** Bobot tiap section dalam skor. Section `training` tidak dihitung (baru Fase 6). */
export const SECTION_WEIGHTS = Object.freeze({
  identitas: 2,
  cara_kerja: 1,
  dipakai_pada: 1,
  spesifikasi: 3,
  spec_baik: 1,
  panduan_beli: 2,
  panduan_pakai: 2,
  risiko: 1,
  keputusan: 1,
  k3_simpan: 1,
  media: 1
});

/** Nilai spek dianggap terisi bila bukan kosong; angka 0 dan boolean false tetap sah. */
export function isSpecValueFilled(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'boolean') return true;
  return txt(v);
}

/** @returns {Array<{key:string,label:string,kritis:boolean}>} field wajib template yang belum terisi. */
export function missingRequiredSpecs(profile, template) {
  const values = profile?.spec_values && typeof profile.spec_values === 'object' ? profile.spec_values : {};
  return (template?.spec_fields || [])
    .filter((f) => f?.wajib && !isSpecValueFilled(values[f.key]))
    .map((f) => ({ key: f.key, label: f.label || f.key, kritis: !!f.kritis }));
}

/** Penilai "selesai/belum" tiap section. */
const CHECKS = {
  identitas: (p) => txt(p.ringkasan) && txt(p.fungsi_utama),
  cara_kerja: (p) => txt(p.cara_kerja),
  dipakai_pada: (p) => list(p.dipakai_pada).length > 0,
  spesifikasi: (p, t) => {
    const fields = t?.spec_fields || [];
    const values = p.spec_values && typeof p.spec_values === 'object' ? p.spec_values : {};
    const wajib = fields.filter((f) => f?.wajib);
    if (wajib.length) return wajib.every((f) => isSpecValueFilled(values[f.key]));
    return fields.some((f) => isSpecValueFilled(values[f.key]));
  },
  spec_baik: (p) => list(p.spec_baik).some((r) => txt(r?.param) && txt(r?.target)),
  panduan_beli: (p) => {
    const b = p.panduan_beli || {};
    return list(b.wajib_cek).length > 0 && (list(b.tanda_palsu).length > 0 || list(b.hindari).length > 0 || list(b.cross_ref_part_no).length > 0);
  },
  panduan_pakai: (p) => {
    const u = p.panduan_pakai || {};
    const interval = num(u.interval_ganti?.nilai) > 0;
    return (interval || txt(u.cara_pasang)) && list(u.tanda_harus_ganti).length > 0;
  },
  risiko: (p) => txt(p.risiko_salah),
  keputusan: (p) => {
    const d = p.decision_rules || {};
    return txt(d.perbaiki_vs_ganti) || txt(d.substitusi_aman) || txt(d.kapan_eskalasi);
  },
  k3_simpan: (p) => list(p.apd).length > 0 || txt(p.bahaya),
  media: (p) => list(p.foto_ids).length > 0 || txt(p.video_url) || !!p.manual_file || !!p.diagram_id
};

/**
 * Hitung skor kelengkapan 0–100 berdasar section aktif template (bobot di SECTION_WEIGHTS).
 * Template null → semua section dihitung. Section spesifikasi tanpa field di template tidak ikut dihitung.
 * @returns {{score:number, sections:Array<{key:string,weight:number,done:boolean}>, missingWajib:Array<{key:string,label:string,kritis:boolean}>}}
 */
export function computeKnowledgeScore(profile, template) {
  const p = profile || {};
  const aktif = Array.isArray(template?.sections_aktif) && template.sections_aktif.length ? template.sections_aktif : Object.keys(SECTION_WEIGHTS);
  const sections = [];
  for (const key of Object.keys(SECTION_WEIGHTS)) {
    if (!aktif.includes(key)) continue;
    if (key === 'spesifikasi' && !(template?.spec_fields || []).length) continue;
    sections.push({ key, weight: SECTION_WEIGHTS[key], done: !!CHECKS[key](p, template) });
  }
  const total = sections.reduce((n, s) => n + s.weight, 0);
  const got = sections.reduce((n, s) => n + (s.done ? s.weight : 0), 0);
  return {
    score: total ? Math.round((got / total) * 100) : 0,
    sections,
    missingWajib: missingRequiredSpecs(p, template)
  };
}

/**
 * Apakah profil boleh diverifikasi? Syarat: skor ≥ ambang DAN semua field spek wajib terisi.
 * @param {number} minScore ambang dari template (fallback setelan) — dipaksa ke 0–100
 * @returns {{ok:boolean, reasons:string[]}}
 */
export function canVerifyProfile(profile, template, minScore) {
  const { score, missingWajib } = computeKnowledgeScore(profile, template);
  const min = Math.min(100, Math.max(0, Number.isFinite(Number(minScore)) ? Number(minScore) : 70));
  const reasons = [];
  if (score < min) reasons.push(`Skor kelengkapan ${score} masih di bawah ambang ${min}.`);
  if (missingWajib.length) reasons.push(`Field spek wajib belum terisi: ${missingWajib.map((m) => m.label).join(', ')}.`);
  return { ok: reasons.length === 0, reasons };
}

const toYmd = (d) => d.toISOString().slice(0, 10);

/** Tanggal tinjau ulang = hari ini + intervalHari (YYYY-MM-DD). Interval ≤ 0 → null (tidak pernah). */
export function computeReviewDueDate(intervalHari, now = new Date()) {
  const n = Number(intervalHari);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() + Math.round(n));
  return toYmd(d);
}

/** Profil verified yang sudah lewat tanggal tinjau ulang dianggap kedaluwarsa. */
export function isProfileStale(profile, now = new Date()) {
  if (profile?.status === 'stale') return true;
  if (profile?.status !== 'verified' || !profile?.review_due_date) return false;
  return String(profile.review_due_date).slice(0, 10) < toYmd(now);
}

/** Status yang ditampilkan: verified yang sudah lewat tanggal tinjau tampil sebagai 'stale'. */
export function effectiveStatus(profile, now = new Date()) {
  if (!profile) return 'belum';
  return isProfileStale(profile, now) ? 'stale' : profile.status || 'draft';
}

/** Bidang isi pengetahuan (bukan flag/meta): perubahan di sini pada profil verified menurunkannya ke 'review'. */
export const CONTENT_FIELDS = Object.freeze([
  'ringkasan', 'fungsi_utama', 'cara_kerja', 'dipakai_pada', 'spec_values', 'spec_baik', 'panduan_beli',
  'panduan_pakai', 'risiko_salah', 'decision_rules', 'apd', 'bahaya', 'foto_ids', 'diagram_id', 'manual_file', 'video_url'
]);

/** Apakah ada perubahan isi antara profil tersimpan dan draft editor? (bandingkan JSON stabil) */
export function hasContentChanged(before, after) {
  const norm = (v) => (v === undefined || v === '' ? null : v);
  return CONTENT_FIELDS.some((k) => JSON.stringify(norm(before?.[k])) !== JSON.stringify(norm(after?.[k])));
}
