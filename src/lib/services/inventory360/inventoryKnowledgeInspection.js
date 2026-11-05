// @ts-nocheck — modul murni berbagi dua repo (project-epi memakai checkJs strict); tipe dijaga lewat tes, bukan JSDoc penuh.
// src/lib/services/inventoryKnowledgeInspection.js
// Inventory 360° Fase C — checklist inspeksi TERIMA barang yang bisa dicentang (konteks 'receive').
// Modul MURNI (tanpa import). Butir diambil dari profil: panduan_beli.wajib_cek (+ tanda_palsu sebagai "pastikan TIDAK ada").
//
// Prinsip: checklist adalah ALAT BANTU — tidak pernah mematikan tombol simpan/terima (Aturan #6) dan tidak memblokir apa pun.
// Hasilnya hanya diringkas jadi satu baris catatan yang ditempel ke catatan dokumen penerimaan (jejak audit ringan).

import { isCardKritis, isCardVerified } from './inventoryKnowledgeView.js';

export const INSPECTION_MAX_WAJIB = 6;
export const INSPECTION_MAX_PALSU = 3;
export const INSPECTION_NOTE_MAX = 240;

const txt = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const list = (v) => (Array.isArray(v) ? v.map(txt).filter(Boolean) : []);

/**
 * Butir checklist dari profil. Id stabil (w0.., p0..) mengikuti urutan isi profil.
 * @param {object|null} profile
 * @returns {Array<{id:string, kind:'wajib_cek'|'tanda_palsu', text:string}>}
 */
export function buildInspectionItems(profile) {
  const pb = profile?.panduan_beli && typeof profile.panduan_beli === 'object' ? profile.panduan_beli : {};
  const wajib = list(pb.wajib_cek).slice(0, INSPECTION_MAX_WAJIB).map((text, i) => ({ id: `w${i}`, kind: 'wajib_cek', text }));
  const palsu = list(pb.tanda_palsu).slice(0, INSPECTION_MAX_PALSU).map((text, i) => ({ id: `p${i}`, kind: 'tanda_palsu', text: `Tidak ada: ${text}` }));
  return [...wajib, ...palsu];
}

/**
 * @param {Array<{id:string}>} items
 * @param {Set<string>|string[]|null} checked id butir yang dicentang
 * @returns {{ done:number, total:number, complete:boolean, missing:string[] }}
 */
export function summarizeInspection(items, checked) {
  const set = checked instanceof Set ? checked : new Set(checked || []);
  const all = items || [];
  const done = all.filter((it) => set.has(it.id)).length;
  return { done, total: all.length, complete: all.length > 0 && done === all.length, missing: all.filter((it) => !set.has(it.id)).map((it) => it.id) };
}

/**
 * Satu baris catatan untuk dokumen penerimaan. Kosong bila tidak ada butir / belum ada yang dicentang.
 * @example "Inspeksi 360° [CAT A]: 3/4 butir (belum: Tanggal produksi)"
 */
export function formatInspectionNote(name, items, checked) {
  const s = summarizeInspection(items, checked);
  if (!s.total || !s.done) return '';
  const label = txt(name) ? ` [${txt(name).slice(0, 40)}]` : '';
  let line = `Inspeksi 360°${label}: ${s.done}/${s.total} butir`;
  if (!s.complete) {
    const miss = (items || []).filter((it) => s.missing.includes(it.id)).map((it) => it.text).slice(0, 2).join(', ');
    line += ` (belum: ${miss})`;
  }
  return line.slice(0, INSPECTION_NOTE_MAX);
}

/** Gabungkan catatan pengguna dengan baris inspeksi tanpa duplikasi; null-safe. */
export function appendInspectionNote(userNote, inspectionLine) {
  const base = txt(userNote);
  const add = txt(inspectionLine);
  if (!add) return base;
  if (base.includes(add)) return base;
  return base ? `${base} · ${add}` : add;
}

// ─── Rekaman terstruktur (koleksi inventory_knowledge_inspection) ─────────────────────────────────
export const INSPECTION_COLLECTION = 'inventory_knowledge_inspection';

/**
 * Baris rekaman inspeksi satu barang pada satu penerimaan. null bila tidak ada butir atau belum ada yang dicentang
 * (tidak ada pemeriksaan yang perlu direkam). Butir disimpan lengkap dengan teksnya, karena isi profil bisa berubah kemudian.
 * @param {{ itemId: number|string, profileId?: number|string|null, items: Array<{id:string, text:string}>, checked: Set<string>|string[]|null, referensi?: string, pemeriksaEmail?: string|null }} p
 * @returns {object|null}
 */
export function buildInspectionRecord({ itemId, profileId = null, items, checked, referensi = '', pemeriksaEmail = null }) {
  const s = summarizeInspection(items, checked);
  if (!s.total || !s.done) return null;
  const set = checked instanceof Set ? checked : new Set(checked || []);
  return {
    item_id: Number(itemId),
    profile_id: profileId != null && Number.isFinite(Number(profileId)) ? Number(profileId) : null,
    konteks: 'receive',
    referensi: txt(referensi).slice(0, 120) || null,
    butir_total: s.total,
    butir_dicentang: s.done,
    lengkap: s.complete,
    butir: items.map((it) => ({ id: it.id, text: txt(it.text).slice(0, 200), checked: set.has(it.id) })),
    pemeriksa_email: pemeriksaEmail ? String(pemeriksaEmail).slice(0, 255) : null
  };
}

/**
 * Ringkas rekaman untuk tampilan admin / gate: berapa penerimaan terperiksa lengkap vs sebagian.
 * @param {Array<{lengkap?:boolean, date_created?:string}>|null} rows
 * @returns {{ total:number, lengkap:number, sebagian:number, terakhir:string|null }}
 */
export function summarizeInspectionRecords(rows) {
  const all = Array.isArray(rows) ? rows : [];
  const lengkap = all.filter((r) => r?.lengkap === true).length;
  const terakhir = all.map((r) => r?.date_created).filter(Boolean).sort().pop() || null;
  return { total: all.length, lengkap, sebagian: all.length - lengkap, terakhir };
}

// ─── Rujukan dokumen & evaluasi kelengkapan (gate G_INV_SPEC_RECEIVE) ─────────────────────────────
/** Jenis dokumen penerimaan yang rekamannya dapat dicocokkan ke gate → kode pendek di token rujukan. */
export const INSPECTION_REF_KINDS = Object.freeze({ 'items/goods_receipt_notes': 'grn', 'items/surat_jalan': 'sj', 'items/stock_transactions': 'stx' });

/**
 * Token rujukan yang ditempel di `referensi` rekaman agar gate bisa mencocokkan rekaman ↔ dokumen tanpa kolom baru.
 * @returns {string|null} mis. "[grn:12]"; null bila jenis dokumen tak dikenal / id kosong.
 */
export function inspectionRefToken(collection, recordId) {
  const kind = INSPECTION_REF_KINDS[collection];
  const id = txt(recordId);
  return kind && id ? `[${kind}:${id}]` : null;
}

/** Rujukan lengkap: teks manusiawi + token. "GRN-001 [grn:12]". */
export function inspectionReference(label, collection, recordId) {
  const token = inspectionRefToken(collection, recordId);
  return [txt(label), token].filter(Boolean).join(' ');
}

/**
 * Evaluasi MURNI: untuk barang KRITIS ber-profil TERVERIFIKASI yang punya butir checklist, dokumen penerimaan ini wajib
 * punya rekaman checklist LENGKAP. (Barang tanpa profil terverifikasi sudah ditemukan oleh evaluator spek; barang
 * non-kritis / tanpa butir checklist tidak dinilai di sini.)
 * @param {Array<{itemId:number, card:object|null}>} entries
 * @param {Map<number, Array<{lengkap?:boolean, butir_dicentang?:number, butir_total?:number}>>} recordsByItem rekaman untuk dokumen ini saja
 * @returns {{ evaluated:number, passed:number, failed:Array<{itemId:number, nama:string, reason:string, text:string}> }}
 */
export function evaluateInspectionCompleteness(entries, recordsByItem) {
  let evaluated = 0;
  let passed = 0;
  const failed = [];
  for (const e of entries || []) {
    const card = e?.card;
    if (!card?.profile || !isCardKritis(card) || !isCardVerified(card)) continue;
    const total = buildInspectionItems(card.profile).length;
    if (!total) continue;
    evaluated += 1;
    const rows = recordsByItem?.get?.(e.itemId) || [];
    if (rows.some((r) => r?.lengkap === true)) {
      passed += 1;
      continue;
    }
    if (!rows.length) {
      failed.push({ itemId: e.itemId, nama: '', reason: 'checklist_tidak_ada', text: 'barang kritis tanpa checklist inspeksi terima pada dokumen ini' });
    } else {
      const best = rows.reduce((m, r) => Math.max(m, Number(r?.butir_dicentang) || 0), 0);
      failed.push({ itemId: e.itemId, nama: '', reason: 'checklist_belum_lengkap', text: `checklist inspeksi terima belum lengkap (${best}/${total} butir)` });
    }
  }
  return { evaluated, passed, failed };
}
