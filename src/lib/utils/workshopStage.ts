// src/lib/utils/workshopStage.ts
// SALINAN dari erp-epi `src/lib/utils/workshopStage.js` (WSK-31) — repo tidak bisa impor lintas repo. UBAH DI KEDUA TEMPAT; tes paritas: workshopStage.test.ts.
// Hanya bagian TAHAP (deriveWorkshopStage); kelengkapan & banner "Langkah Berikutnya" hanya dipakai dashboard admin.
// WSK-31 §4a — SATU fungsi tahap PO workshop, SATU kosakata (MURNI, teruji; boleh disalin ke project-epi).
// Menggantikan 6 sistem yang berjalan sendiri (cockpit F0–F5, Hub T1–T7, Modal T1–T8, HP F0–F5, status_barang, projects.status).
//
// Prinsip:
//  - Tahap hanya dari sinyal NYATA. Leader/SDM/charter BUKAN tahap melainkan KELENGKAPAN (checklist); leader hasil fast-track
//    (otomatis) ditandai "otomatis — konfirmasi", tidak dihitung sebagai alokasi SDM.
//  - SJ Masuk CONSUMABLE (cat/thinner/material pembelian) bukan "barang customer diterima".
//  - Anti-lockdown retroaktif: ada laporan produksi untuk PO ⇒ barang pasti sudah ada ⇒ minimal tahap "inbound".
//  - QC tidak diwajibkan di operasional (0 inspeksi approved) ⇒ `qcRequired=false` melompati QC saat produksi selesai.
//  - Tahap "tagih" memakai status pembayaran (WSK-30), bukan status proyek.

export const WORKSHOP_STAGES = Object.freeze<{ key: string; label: string; cockpit: string; sub?: string[] }[]>([
  { key: 'order', label: 'Order masuk', cockpit: 'F0' },
  { key: 'inbound', label: 'Barang customer diterima', cockpit: 'F1' },
  { key: 'produksi', label: 'Blasting & coating', cockpit: 'F2', sub: ['sandblasting', 'primer', 'intermediate', 'topcoat'] },
  { key: 'qc', label: 'QC / inspeksi', cockpit: 'F3' },
  { key: 'siap_kirim', label: 'Siap kirim', cockpit: 'F4' },
  { key: 'dikirim', label: 'Diserahkan ke customer', cockpit: 'F5' },
  { key: 'tagih', label: 'Ditagih / lunas', cockpit: 'F5' }
]);

export const WORKSHOP_STAGE_KEYS: readonly string[] = Object.freeze(WORKSHOP_STAGES.map((s) => s.key));
export const DEFAULT_STAGE_THRESHOLDS = Object.freeze({ stage_done_threshold_pct: 100 });

const num = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const idxOf = (key: string): number => WORKSHOP_STAGE_KEYS.indexOf(key);

export interface WorkshopStageSignals {
  /** projects.status (hanya untuk overlay 'repair'; TIDAK menentukan tahap) */ status?: string;
  /** >=1 SJ Masuk BARANG CUSTOMER (bukan consumable) */ hasCustomerSjMasuk?: boolean;
  hasAnySjMasuk?: boolean;
  /** ada baris laporan harian (workshop_report_po_detail) untuk PO ini */ hasProduksiReport?: boolean;
  sandblastingSum?: number; primerSum?: number; secondSum?: number; topcoatSum?: number;
  totalObjek?: number; sudahDikerjakan?: number;
  /** total_progress project, 0–100 */ progressPct?: number;
  qcRequired?: boolean;
  hasInspeksiDraft?: boolean; hasInspeksiApproved?: boolean;
  sjKeluarCount?: number; /** terkirim / diterima */ sjKeluarDeliveredCount?: number;
  /** ada invoice resmi (non-draft, non-batal) */ hasOfficialInvoice?: boolean;
  hasKomplainOpen?: boolean;
}

export interface WorkshopStageResult {
  key: string; label: string; sub: string | null; cockpitKey: string; reason: string;
  /** kode sumber singkat (untuk log/diagnostik) */ hint: string;
  overlay: 'repair' | null; index: number; partialDelivery: boolean;
}

/**
 * @param {WorkshopStageSignals} s
 * @param {{ stage_done_threshold_pct?: number }} [thresholds]
 * @returns {{ key: string, label: string, sub: string|null, cockpitKey: string, reason: string, hint: string, overlay: 'repair'|null, index: number, partialDelivery: boolean }}
 *   hint = kode sumber singkat (untuk log/diagnostik cockpit)
 */
export function deriveWorkshopStage(s: WorkshopStageSignals = {}, thresholds: { stage_done_threshold_pct?: number } = DEFAULT_STAGE_THRESHOLDS): WorkshopStageResult {
  const done = num(thresholds?.stage_done_threshold_pct) || 100;
  const sand = num(s.sandblastingSum), primer = num(s.primerSum), second = num(s.secondSum), top = num(s.topcoatSum);
  const totalObjek = num(s.totalObjek), sudah = num(s.sudahDikerjakan);
  const objekPct = totalObjek > 0 ? (sudah / totalObjek) * 100 : 0;
  const progressPct = num(s.progressPct);
  const produksiSelesai = (totalObjek > 0 && objekPct >= done) || progressPct >= done;
  const sjkTotal = num(s.sjKeluarCount), sjkOut = num(s.sjKeluarDeliveredCount);
  const allDelivered = sjkTotal > 0 && sjkOut >= sjkTotal;
  const qcRequired = s.qcRequired !== false;

  let key: string = 'order';
  let reason = 'Order masuk — belum ada barang customer / laporan produksi';
  let sub: string | null = null;
  let hint = 'default';

  if (s.hasCustomerSjMasuk || s.hasProduksiReport) {
    key = 'inbound';
    reason = s.hasCustomerSjMasuk ? 'SJ Masuk barang customer tercatat' : 'Ada laporan produksi (barang pasti sudah diterima)';
    hint = 'sj_masuk_atau_po_detail';
  }
  if (sand + primer + second + top + progressPct > 0) {
    key = 'produksi';
    sub = top > 0 ? 'topcoat' : second > 0 ? 'intermediate' : primer > 0 ? 'primer' : 'sandblasting';
    reason = `Produksi berjalan (${sub}${progressPct > 0 ? `, progres ${Math.round(progressPct)}%` : ''})`;
    hint = sub === 'sandblasting' ? 'sandblasting>0' : 'coating_wip';
  }
  if (produksiSelesai || s.hasInspeksiDraft) {
    sub = null;
    if (qcRequired) {
      key = 'qc';
      reason = produksiSelesai ? 'Produksi selesai — menunggu QC/inspeksi' : 'Inspeksi QC sedang diproses';
      hint = produksiSelesai ? 'objek_selesai' : 'inspeksi_draft';
    } else if (produksiSelesai) {
      key = 'siap_kirim';
      reason = 'Produksi selesai (QC tidak diwajibkan)';
      hint = 'objek_selesai';
    }
  }
  if (s.hasInspeksiApproved) {
    key = 'siap_kirim';
    reason = 'QC/inspeksi disetujui';
    hint = 'inspeksi_approved';
  }
  if (sjkTotal > 0 && !allDelivered) {
    // Fallback disengaja (Aturan #3): SJ Keluar sudah dibuat ⇒ barang sudah siap/dalam pengiriman, meski inspeksi tak pernah dicatat.
    key = 'siap_kirim';
    reason = `SJ Keluar dibuat (${sjkOut}/${sjkTotal} diserahkan)`;
    if (!s.hasInspeksiApproved) hint = 'sj_keluar_pending_fallback';
  }
  if (allDelivered) {
    key = s.hasOfficialInvoice ? 'tagih' : 'dikirim';
    reason = s.hasOfficialInvoice ? 'Seluruh SJ Keluar diserahkan dan sudah ditagih (invoice resmi)' : 'Seluruh SJ Keluar diserahkan — belum ada invoice resmi';
    hint = 'sj_keluar_terkirim';
  }

  const meta = WORKSHOP_STAGES.find((x) => x.key === key)!;
  const cockpitKey = key === 'produksi' ? (sub === 'sandblasting' || sub === null ? 'F2a' : 'F2b') : meta.cockpit;
  return {
    key, label: meta.label, sub, cockpitKey, reason, hint,
    overlay: (s.status === 'repair' || s.hasKomplainOpen) ? 'repair' : null,
    index: idxOf(key),
    partialDelivery: sjkTotal > 0 && sjkOut > 0 && !allDelivered
  };
}
