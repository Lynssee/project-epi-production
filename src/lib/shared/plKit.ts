// @ts-nocheck
// SALINAN KONTRAK dari erp-epi/src/lib/utils/plKit.js (Rencana Keyakinan Permintaan PL, sinkron 12 Nov 2026).
// JANGAN diedit di sini: ubah di erp-epi lalu salin ulang. Paritas isi dijaga tes kontrak lintas repo
// erp-epi/src/lib/server/gates/plCoverage.crossRepoContract.test.js (gagal bila kedua salinan menyimpang).
// '@ts-nocheck' disengaja: file ini JS murni yang identik dengan sisi admin; tipe tidak boleh membuatnya berbeda.
// src/lib/utils/plKit.js
// Modul MURNI (tanpa Directus / DOM). Kit Standar per jenis pekerjaan (Rencana Keyakinan Permintaan PL, Fase 2):
// daftar minimum barang yang harus dibawa untuk jenis pekerjaan tertentu — terutama ALAT INSPEKSI yang sering tertinggal
// (mis. DFT gauge/hygrometer pada pekerjaan floor coating). Definisi kit disimpan di app_settings (module 'project',
// key `pkl_kit.definitions`, JSON) sehingga bisa diubah superadmin lewat UI; bila belum ada, KIT_DEFAULTS dipakai.
//
// Pencocokan item = KATA KUNCI pada nama barang (tidak peka huruf besar/kecil, spasi di sekitar '-' disamakan), karena master
// bernomor unit ("DFT ELCOMETER 456 NO. 01") dan nama bebas rapuh dicocokkan persis. Satu butir kit terpenuhi bila SALAH SATU
// kata kunci muncul pada nama barang di: permintaan ini, permintaan komit lain proyek, atau stok/penugasan yang sudah ada di site.
// Doktrin: kit tidak ditemukan / data kosong ⇒ N/A (bukan gagal); hanya butir WAJIB (mandatory) yang membuat kit "tidak lengkap".
// Null-safe: semua input boleh null/undefined.

export const KIT_ITEM_CLASSES = Object.freeze(['material', 'alat_kerja', 'alat_inspeksi', 'apd', 'consumable']);
export const KIT_CLASS_LABEL = Object.freeze({
  material: 'Material', alat_kerja: 'Alat kerja', alat_inspeksi: 'Alat inspeksi', apd: 'APD', consumable: 'Consumable'
});

/** Kit bawaan (draf usulan — dikonfirmasi/diubah superadmin di /settings/packing-list). */
export const KIT_DEFAULTS = Object.freeze([
  {
    key: 'floor_coating', label: 'Floor Coating / Epoxy Lantai', active: true,
    triggers: { jenis_project: ['Epoxy / Floor Coating'], hse_work_types: ['coating'] },
    items: [
      { label: 'DFT gauge (ketebalan film kering)', item_class: 'alat_inspeksi', mandatory: true, keywords: ['DFT', 'DRY FILM'] },
      { label: 'Hygrometer / dew point meter', item_class: 'alat_inspeksi', mandatory: true, keywords: ['HYGROMETER', 'DEW POINT'] },
      { label: 'Moisture meter beton', item_class: 'alat_inspeksi', mandatory: true, keywords: ['MOISTURE'] },
      { label: 'Holiday detector', item_class: 'alat_inspeksi', mandatory: false, keywords: ['HOLIDAY'] },
      { label: 'Pull-off adhesion tester', item_class: 'alat_inspeksi', mandatory: false, keywords: ['PULL OFF', 'PULL-OFF'] },
      { label: 'Surface profile / comparator', item_class: 'alat_inspeksi', mandatory: false, keywords: ['COMPARATOR', 'PROFIL', 'PROFILE'] },
      { label: 'Mixer cat', item_class: 'alat_kerja', mandatory: false, keywords: ['MIXER'] },
      { label: 'Respirator / masker kimia', item_class: 'apd', mandatory: false, keywords: ['RESPIRATOR'] },
      { label: 'Coverall / wearpack', item_class: 'apd', mandatory: false, keywords: ['WEARPACK', 'COVERALL', 'BAJU FOXA'] }
    ]
  },
  {
    key: 'sandblasting', label: 'Sandblasting / Wetblasting', active: true,
    triggers: { jenis_project: ['Sandblasting', 'Wetblasting'], hse_work_types: ['sandblasting'] },
    items: [
      { label: 'DFT gauge (ketebalan film kering)', item_class: 'alat_inspeksi', mandatory: true, keywords: ['DFT', 'DRY FILM'] },
      { label: 'Hygrometer / dew point meter', item_class: 'alat_inspeksi', mandatory: true, keywords: ['HYGROMETER', 'DEW POINT'] },
      { label: 'Surface comparator / roughness gauge', item_class: 'alat_inspeksi', mandatory: true, keywords: ['COMPARATOR', 'ROUGHNESS', 'PROFIL', 'PROFILE'] },
      { label: 'Thermometer permukaan', item_class: 'alat_inspeksi', mandatory: true, keywords: ['THERMOMETER'] },
      { label: 'Salt test', item_class: 'alat_inspeksi', mandatory: false, keywords: ['SALT TEST'] },
      { label: 'Wet film thickness gauge', item_class: 'alat_inspeksi', mandatory: false, keywords: ['WET FILM'] },
      { label: 'Respirator / masker blasting', item_class: 'apd', mandatory: false, keywords: ['RESPIRATOR'] },
      { label: 'Breathing filter', item_class: 'alat_kerja', mandatory: false, keywords: ['BREATHING FILTER'] }
    ]
  }
]);

const norm = (s) => String(s ?? '').toUpperCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
const lc = (s) => String(s ?? '').trim().toLowerCase();
const arr = (v) => (Array.isArray(v) ? v : []);

/** Bersihkan definisi dari klien/setelan: buang entri rusak, batasi ukuran. Tidak melempar. */
export function sanitizeKits(raw) {
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch { return []; } }
  const kits = [];
  for (const k of arr(list).slice(0, 30)) {
    const key = String(k?.key ?? '').trim().replace(/[^a-z0-9_]/gi, '_').slice(0, 40);
    const label = String(k?.label ?? '').trim().slice(0, 80);
    if (!key || !label) continue;
    const items = [];
    for (const it of arr(k.items).slice(0, 80)) {
      const l = String(it?.label ?? '').trim().slice(0, 100);
      const keywords = [...new Set(arr(it?.keywords).map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, 12);
      if (!l || !keywords.length) continue;
      items.push({ label: l, item_class: KIT_ITEM_CLASSES.includes(it?.item_class) ? it.item_class : 'alat_kerja', mandatory: it?.mandatory === true || it?.mandatory === 'true', keywords });
    }
    kits.push({
      key, label, active: k?.active !== false,
      triggers: {
        jenis_project: [...new Set(arr(k?.triggers?.jenis_project).map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, 20),
        hse_work_types: [...new Set(arr(k?.triggers?.hse_work_types).map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, 20)
      },
      items
    });
  }
  return kits;
}

/** Kit yang berlaku untuk proyek: cocok jenis_project ATAU salah satu hse_work_types (tak peka huruf besar/kecil), hanya yang aktif. */
export function pickKitsForProject(kits, project) {
  const jenis = lc(project?.jenis_project);
  const work = new Set(arr(project?.hse_work_types).map(lc).filter(Boolean));
  return arr(kits).filter((k) => k && k.active !== false && (
    (jenis && arr(k.triggers?.jenis_project).some((j) => lc(j) === jenis)) ||
    arr(k.triggers?.hse_work_types).some((w) => work.has(lc(w)))
  ));
}

/** Apakah nama barang memuat salah satu kata kunci butir kit. */
export function itemMatches(item, name) {
  const hay = norm(name);
  if (!hay) return false;
  return arr(item?.keywords).some((kw) => { const k = norm(kw); return k && hay.includes(k); });
}

/**
 * Evaluasi satu kit terhadap tiga sumber nama barang.
 * @param {{key:string,label:string,items:Array<object>}} kit
 * @param {{ request?:string[], committed?:string[], site?:string[] }} sources
 *   request = nama barang di permintaan ini; committed = permintaan komit lain proyek yang sama; site = stok/alat yang sudah ada di site
 * @returns {{ kit_key:string, kit_label:string, total:number, mandatory_total:number, items:Array<object>, missing_mandatory:Array<object>, missing_optional:Array<object>, complete:boolean }}
 */
export function evaluateKit(kit, sources) {
  const src = { request: arr(sources?.request), committed: arr(sources?.committed), site: arr(sources?.site) };
  const rows = arr(kit?.items).map((it) => {
    const inRequest = src.request.some((n) => itemMatches(it, n));
    const inCommitted = !inRequest && src.committed.some((n) => itemMatches(it, n));
    const onSite = !inRequest && !inCommitted && src.site.some((n) => itemMatches(it, n));
    return { ...it, status: inRequest ? 'in_request' : inCommitted ? 'committed' : onSite ? 'on_site' : 'missing' };
  });
  const missing = rows.filter((r) => r.status === 'missing');
  return {
    kit_key: kit?.key || '', kit_label: kit?.label || '', total: rows.length, mandatory_total: rows.filter((r) => r.mandatory).length,
    items: rows, missing_mandatory: missing.filter((r) => r.mandatory), missing_optional: missing.filter((r) => !r.mandatory),
    complete: missing.every((r) => !r.mandatory)
  };
}

/**
 * Evaluasi semua kit yang berlaku untuk proyek. status: 'not_applicable' (tak ada kit berlaku / kit tanpa butir wajib),
 * 'failed' (ada butir wajib yang belum ada di mana pun), 'passed'.
 */
export function evaluateProjectKits(kits, project, sources) {
  const applicable = pickKitsForProject(kits, project);
  const results = applicable.map((k) => evaluateKit(k, sources));
  const withMandatory = results.filter((r) => r.mandatory_total > 0);
  const missing = results.flatMap((r) => r.missing_mandatory.map((m) => ({ ...m, kit_key: r.kit_key, kit_label: r.kit_label })));
  const status = !withMandatory.length ? 'not_applicable' : missing.length ? 'failed' : 'passed';
  return { status, kits: results, missing_mandatory: missing };
}
