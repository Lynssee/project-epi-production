// src/lib/shared/projectSpecDft.js
// ⚠️ KONTRAK LINTAS REPO: file ini HARUS identik byte-per-byte dengan
//    project-epi/src/lib/shared/projectSpecDft.js (dijaga oleh projectSpecDft.contract.test.js di erp-epi).
//    Ubah di salah satu → salin ke yang lain.
//
// Inti MURNI (tanpa I/O) untuk membaca spesifikasi teknis objek proyek (project_objects.spesifikasi_teknis,
// skema lengkap di erp-epi/src/lib/shared/projectScopeSpec.js) dan membandingkan hasil ukur DFT lapangan
// dengan target lapisan. Dipakai kartu spesifikasi & form inspeksi di dashboard lapangan.

/** Toleransi bawaan bila lapisan tidak punya toleransi_min/max (persen dari target; acuan SSPC-PA 2). */
export const DEFAULT_DFT_TOL_MIN_PCT = 80;
export const DEFAULT_DFT_TOL_MAX_PCT = 120;

const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Terima JSON string / object / null dari Directus → object (atau null bila tak terbaca). */
export function parseSpecJson(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return p && typeof p === 'object' && !Array.isArray(p) ? p : null; } catch { return null; }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

/**
 * Lapisan bertarget > 0 dari spesifikasi, dinormalkan: { no, tahap, merk, target, min, max }.
 * Toleransi kosong/tak konsisten (min > target atau max < target) diganti default persen dari target.
 */
export function specLayers(spec, { tolMinPct = DEFAULT_DFT_TOL_MIN_PCT, tolMaxPct = DEFAULT_DFT_TOL_MAX_PCT } = {}) {
  const raw = Array.isArray(spec?.sistem_lapisan) ? spec.sistem_lapisan : [];
  const out = [];
  raw.forEach((l, i) => {
    const target = toNum(l?.target_micron);
    if (target === null || target <= 0) return;
    let min = toNum(l?.toleransi_min);
    let max = toNum(l?.toleransi_max);
    if (min === null || min > target) min = Math.round((target * tolMinPct) / 100);
    if (max === null || max < target) max = Math.round((target * tolMaxPct) / 100);
    out.push({ no: i + 1, tahap: String(l?.tahap || '').trim(), merk: String(l?.merk_produk || '').trim(), target, min, max });
  });
  return out;
}

/** Total target DFT (µm) semua lapisan bertarget > 0. */
export function specTotalMicron(spec) {
  return specLayers(spec).reduce((s, l) => s + l.target, 0);
}

/**
 * Bandingkan titik ukur DFT dengan satu lapisan spesifikasi.
 * Status berdasar RATA-RATA terhadap rentang toleransi lapisan (nilai ≤ 0 / non-angka diabaikan):
 *   'kosong' (belum ada pembacaan) | 'memenuhi' | 'kurang' (< min) | 'over' (> max).
 * Aturan 85/15 SSPC-PA 2 tetap dinilai terpisah oleh validateDft8515 di form inspeksi.
 */
export function compareDftToLayer(readings, layer) {
  const vals = (Array.isArray(readings) ? readings : []).map(toNum).filter((v) => v !== null && v > 0);
  if (!layer || !(layer.target > 0)) return { status: 'kosong', avg: null, count: 0, belowMin: 0, aboveMax: 0, layer: layer || null, message: 'Lapisan acuan tidak tersedia.' };
  if (vals.length === 0) return { status: 'kosong', avg: null, count: 0, belowMin: 0, aboveMax: 0, layer, message: 'Belum ada pembacaan DFT.' };
  const avg = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  const belowMin = vals.filter((v) => v < layer.min).length;
  const aboveMax = vals.filter((v) => v > layer.max).length;
  let status = 'memenuhi';
  let message = `Rata-rata ${avg} µm memenuhi spesifikasi (${layer.min}–${layer.max} µm, target ${layer.target}).`;
  if (avg < layer.min) {
    status = 'kurang';
    message = `Kurang tebal: rata-rata ${avg} µm di bawah batas ${layer.min} µm (target ${layer.target}). Tambah lapisan sebelum cat mengering penuh.`;
  } else if (avg > layer.max) {
    status = 'over';
    message = `Terlalu tebal: rata-rata ${avg} µm di atas batas ${layer.max} µm (target ${layer.target}). Risiko retak/pengelupasan & boros cat.`;
  }
  return { status, avg, count: vals.length, belowMin, aboveMax, layer, message };
}

// ---------------------------------------------------------------------------------------------------------
// Tahap foto progres per objek (project_object_activities.tahap). Kunci stabil, label dibangun dari spesifikasi.
// ---------------------------------------------------------------------------------------------------------

/**
 * Daftar tahap pengambilan foto untuk satu objek: persiapan → tiap lapisan bertarget → hasil akhir → lainnya.
 * Kunci: 'persiapan' | 'lapisan_<no>' | 'hasil_akhir' | 'lainnya' (no = nomor lapisan di spesifikasi).
 */
export function specPhotoStages(spec, tipe) {
  const s = parseSpecJson(spec);
  const lantai = tipe === 'lantai' || s?.kategori_pekerjaan === 'floor_coating';
  const sa = String(s?.surface_preparation?.standar_sa || '').trim();
  const stages = [{ key: 'persiapan', label: lantai ? 'Persiapan substrat' : `Blasting / persiapan permukaan${sa ? ` (${sa})` : ''}` }];
  for (const l of specLayers(s)) stages.push({ key: `lapisan_${l.no}`, label: `L${l.no} ${l.tahap || 'Lapisan'}` });
  stages.push({ key: 'hasil_akhir', label: 'Hasil akhir' });
  stages.push({ key: 'lainnya', label: 'Lainnya' });
  return stages;
}

/** Label tahap untuk tampilan; kunci tak dikenal tampil apa adanya, kosong → 'Umum'. */
export function photoStageLabel(key, spec, tipe) {
  const k = String(key || '').trim();
  if (!k) return 'Umum';
  return specPhotoStages(spec, tipe).find((x) => x.key === k)?.label || k;
}
