// Normalisasi kategori RAP/realisasi ke bucket tampilan standar (PRJ-06).
// ⚠️ SINKRON dengan erp-epi `src/lib/finance/expenseTypeMap.js` (RAP_CATEGORY_ALIASES +
// normalizeRapCategoryKey) — ubah KEDUANYA bersamaan. rapCategory.test.ts memeriksa isinya identik.

export const RAP_CATEGORY_ALIASES: Record<string, string> = {
  // supplier
  supplier: 'supplier', material: 'supplier', packing_supplier: 'supplier',
  // jasa
  jasa: 'jasa', man_power: 'jasa', manpower: 'jasa', subkon: 'jasa', subkontraktor: 'jasa',
  // sewa_alat (termasuk sewa_vendor)
  sewa_alat: 'sewa_alat', sewa_vendor: 'sewa_alat', packing_sewa_alat: 'sewa_alat',
  // consumable
  consumable: 'consumable', sparepart: 'consumable', packing_consumable: 'consumable',
  // operasional
  operasional: 'operasional', reimbursement: 'operasional', packing_operasional: 'operasional',
  // safety
  safety: 'safety', packing_safety: 'safety',
  // overhead_sdm
  overhead_sdm: 'overhead_sdm',
  // lain_lain
  lain_lain: 'lain_lain', packing_lain_lain: 'lain_lain',
  gaji_manpower: 'jasa', borongan_manpower_termin: 'jasa', subkon_jasa: 'jasa',
  subkontraktor_termin: 'jasa', komisi_internal: 'jasa', komisi_external: 'jasa',
  material_supplier: 'supplier', hse_apd: 'safety', hse_fasilitas_k3: 'safety', hse_k3: 'safety'
};

const clean = (raw: unknown) => String(raw ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');

/** Nilai mentah → bucket. Nilai tak dikenal → null (pemanggil memutuskan; jangan dibuang diam-diam). */
export function lookupRapCategory(raw: unknown): string | null {
  const c = clean(raw);
  if (!c) return 'lain_lain';
  return RAP_CATEGORY_ALIASES[c] ?? null;
}

export function normalizeRapCategoryKey(raw: unknown): string {
  return lookupRapCategory(raw) ?? 'lain_lain';
}

/** Paket (packing_*) bukan bagian Total RAP (PRJ-10, K7). */
export const isPackingCategory = (raw: unknown) => clean(raw).startsWith('packing_');

/**
 * Tentukan kartu tujuan untuk satu nilai mentah, berdasarkan daftar kartu yang tersedia:
 * kode persis yang ada di daftar menang (mis. 'sewa_vendor' bila kartunya ada); selain itu
 * dinormalisasi lewat alias; bila bucket tak ada di daftar → 'lain_lain'.
 */
export function resolveCategoryBucket(raw: unknown, availableIds: Set<string>): { bucket: string; unknown: boolean } {
  const c = clean(raw) || 'operasional';
  if (availableIds.has(c)) return { bucket: c, unknown: false };
  const mapped = lookupRapCategory(c);
  if (mapped === null) return { bucket: 'lain_lain', unknown: true };
  return { bucket: availableIds.has(mapped) ? mapped : 'lain_lain', unknown: false };
}
