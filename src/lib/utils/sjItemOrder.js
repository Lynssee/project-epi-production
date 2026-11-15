// PDI-67 — urutan baris Surat Jalan SAMA dengan urutan baris Packing List (layar, cetak, kiosk).
//
// Keputusan Inventory (poin 67): baris SJ disusun mengikuti urutan baris PL; SJ tanpa PL mengikuti urutan input.
//
// Skema live (6 Nov 2026): `packing_list_items` TIDAK punya kolom sort/urutan, dan `surat_jalan_items` hanya punya
// `packing_list_item_id` — jadi urutan PL = id baris PL (urutan dibuat). Karena itu fungsi ini cukup membaca
// `packing_list_item_id` yang sudah ada di baris SJ: tanpa query tambahan (hemat API). Bila kelak PL punya kolom
// urutan, kirim `plOrder` (Map id baris PL → urutan) tanpa mengubah pemanggil.
//
// MIRROR (cermin): salinan identik dari erp-epi/src/lib/utils/sjItemOrder.js (repo terpisah). Ubah KEDUANYA sekaligus.

const idOf = (v) => (v && typeof v === 'object' ? v.id : v);
const num = (v) => {
  const n = Number(idOf(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * Urutkan baris SJ mengikuti urutan baris PL. Murni, tidak mengubah array masukan, stabil.
 *  1) baris bertaut PL (`packing_list_item_id`) → urut menurut posisi baris PL-nya;
 *  2) baris tanpa tautan (penambahan belakangan / SJ tanpa PL) → setelahnya, urut id baris SJ (urutan input).
 * Baris SJ tanpa PL sama sekali → urut id SJ (urutan input).
 *
 * @template {{ id?: any, packing_list_item_id?: any }} T
 * @param {T[]} sjItems
 * @param {Map<any, number>|Record<string, number>|null} [plOrder] urutan eksplisit per id baris PL (opsional)
 * @returns {T[]}
 */
export function sortSjItemsLikePl(sjItems, plOrder = null) {
  if (!Array.isArray(sjItems)) return [];
  const orderOf = (plItemId) => {
    if (plOrder) {
      const v = plOrder instanceof Map ? plOrder.get(plItemId) : plOrder[plItemId];
      if (Number.isFinite(Number(v))) return Number(v);
    }
    return num(plItemId);
  };
  const keyed = sjItems.map((row, index) => {
    const pl = row?.packing_list_item_id;
    const plPos = pl == null || pl === '' ? null : orderOf(idOf(pl));
    return { row, index, plPos, own: num(row?.id) };
  });
  keyed.sort((a, b) => {
    const aLinked = a.plPos != null;
    const bLinked = b.plPos != null;
    if (aLinked !== bLinked) return aLinked ? -1 : 1; // baris PL dulu, tambahan belakangan
    if (aLinked && a.plPos !== b.plPos) return a.plPos - b.plPos;
    if (a.own != null && b.own != null && a.own !== b.own) return a.own - b.own; // urutan input
    return a.index - b.index; // stabil
  });
  return keyed.map((k) => k.row);
}
