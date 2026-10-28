/**
 * Kontrak tunggal lifecycle customer — Fase 4 dari rencana v2
 * `docs/(joe) implementation_plan_Lifecycle_Customer_Awareness_ke_PO_dan_Audit_PA.md`.
 *
 * TIDAK ada network call di file ini (murni, testable tanpa Directus) — pola sama
 * dengan procurementLifecycle.js (Aturan #2: fetch relasi terpisah oleh pemanggil).
 *
 * Keputusan kunci (§3.1-3.2 rencana, 14 Sep 2026):
 *   - Anchor = SO (`so_customer`), BUKAN lead — 99% SO tidak punya jejak hulu
 *     (lead/penawaran), jadi fase hulu (C1-C3) tampil sebagai "tidak tercatat"
 *     (abu-abu, conditional) bukan "gagal".
 *   - Fakta (baris nyata: prospects.converted_so_customer_id, sales_survey,
 *     kalkulator_penawaran.linked_so_id/quotations.so_id, master_customer.verification_status,
 *     so.po_status, surat_jalan, invoices, pengajuan_anggaran komisi) adalah kebenaran utama.
 *   - Status manual (so.status) adalah KLAIM, fallback saat fakta kosong.
 *   - Konflik fakta vs klaim -> conflict:true, badge "Status bentrok" (pola sama procurementLifecycle).
 *   - Ada DUA sistem penawaran (quotations CRM + kalkulator_penawaran, dijembatani
 *     bridged_quotation_id) — C3 membaca KEDUANYA, tidak membuat sistem ketiga.
 */

/** @typedef {'selesai'|'proses'|'belum'|'gagal'} PhaseState */
/** @typedef {'fakta'|'klaim'|'kosong'} EvidenceSource */

export const LIFECYCLE_PHASES = [
  { id: 'C1', label: 'Asal & Lead', hint: 'Lead di CRM yang berujung ke SO ini (prospects.converted_so_customer_id). Abu-abu = tidak tercatat, bukan gagal — mayoritas SO memang tidak berasal dari lead tercatat.', conditional: true },
  { id: 'C2', label: 'Survey', hint: 'Survey lapangan yang tertaut ke SO ini sebelum pekerjaan dimulai.', conditional: true },
  { id: 'C3', label: 'Penawaran & Margin', hint: 'Penawaran (CRM atau kalkulator) yang tertaut ke SO ini, termasuk margin saat itu.', conditional: true },
  { id: 'C4', label: 'Verifikasi Customer', hint: 'Status verifikasi customer (KYC) di Master Customer — syarat gate CV1 untuk SO skema tempo.', conditional: false },
  { id: 'C5', label: 'SO & PO Customer', hint: 'Dokumen PO dari customer sudah diunggah dan diverifikasi.', conditional: false },
  { id: 'C6', label: 'Pengiriman', hint: 'Surat Jalan untuk SO ini sudah terkirim/diterima.', conditional: false },
  { id: 'C7', label: 'Penagihan', hint: 'Invoice untuk SO ini sudah diterbitkan resmi (POSTED), bukan sekadar draft.', conditional: false },
  { id: 'C8', label: 'Pelunasan', hint: 'Invoice untuk SO ini sudah dibayar lunas oleh customer.', conditional: false },
  { id: 'C9', label: 'Komisi Agen', hint: 'Pengajuan komisi (eksternal/internal) untuk SO ini — hanya tampil bila ada.', conditional: true },
];

function phase(id, state, source, evidence, extra = {}) {
  const meta = LIFECYCLE_PHASES.find((p) => p.id === id);
  return {
    id,
    label: meta?.label ?? id,
    hint: meta?.hint ?? '',
    conditional: meta?.conditional ?? false,
    state,
    source,
    evidence,
    conflict: false,
    actor: null,
    date: null,
    ...extra,
  };
}

const SO_SHIPPED_CLAIM = new Set(['in_delivery', 'partial_delivery', 'delivered', 'invoiced', 'paid', 'completed']);
const SO_INVOICED_CLAIM = new Set(['invoiced', 'paid', 'completed']);
const SO_PAID_CLAIM = new Set(['paid', 'completed']);
const SJ_DELIVERED_STATUSES = new Set(['delivered', 'received', 'complete', 'closed']);
const SJ_IN_PROGRESS_STATUSES = new Set(['loading', 'shipped', 'needs_security_check']);

/** C1 — Asal & Lead. Fakta = prospects.converted_so_customer_id === so.id. Tanpa fallback klaim (tidak ada kolom lain). */
function resolveC1(so, prospect) {
  if (!so) return phase('C1', 'belum', 'kosong', 'Belum ada SO.');
  if (prospect && String(prospect.converted_so_customer_id) === String(so.id)) {
    return phase('C1', 'selesai', 'fakta', `Berasal dari lead "${prospect.company || prospect.name || prospect.id}" (${prospect.source_channel || 'sumber tidak dicatat'}).`, { date: prospect.date_created ?? null });
  }
  return phase('C1', 'belum', 'kosong', 'Tidak ada lead tercatat yang berujung ke SO ini — SO dibuat langsung.');
}

/** C2 — Survey. Fakta = baris sales_survey dengan so_customer_id === so.id. */
function resolveC2(so, surveys) {
  if (!so) return phase('C2', 'belum', 'kosong', 'Belum ada SO.');
  const list = (surveys || []).filter((s) => String(s.so_customer_id) === String(so.id));
  if (list.length === 0) return phase('C2', 'belum', 'kosong', 'Tidak ada survey tercatat untuk SO ini.');
  const anyCompleted = list.some((s) => s.status === 'completed');
  if (anyCompleted) {
    return phase('C2', 'selesai', 'fakta', `${list.length} survey tercatat, sudah selesai.`, { date: list[0].date_updated || list[0].date_created || null });
  }
  return phase('C2', 'proses', 'fakta', `${list.length} survey tercatat, belum ditandai selesai.`);
}

/** C3 — Penawaran & Margin. Fakta = quotations.so_id ATAU kalkulator_penawaran.linked_so_id (dua sistem, dibaca keduanya). */
function resolveC3(so, quotations, kalkulatorPenawaran) {
  if (!so) return phase('C3', 'belum', 'kosong', 'Belum ada SO.');
  const quoteMatches = (quotations || []).filter((q) => String(q.so_id) === String(so.id));
  const kalkMatches = (kalkulatorPenawaran || []).filter((k) => String(k.linked_so_id) === String(so.id));
  if (quoteMatches.length === 0 && kalkMatches.length === 0) {
    return phase('C3', 'belum', 'kosong', 'Tidak ada penawaran (CRM maupun kalkulator) tertaut ke SO ini.');
  }
  const marginParts = kalkMatches
    .map((k) => (k.margin_terkini_pct ?? k.margin_snapshot_pct))
    .filter((v) => v != null);
  const marginInfo = marginParts.length ? ` Margin terakhir tercatat ${marginParts[marginParts.length - 1]}%.` : '';
  const totalCount = quoteMatches.length + kalkMatches.length;
  return phase('C3', 'selesai', 'fakta', `${totalCount} penawaran tertaut ke SO ini.${marginInfo}`);
}

/** C4 — Verifikasi Customer. Fakta = master_customer.verification_status. Fallback klaim = so.credit_status. */
function resolveC4(so, masterCustomer) {
  if (!so) return phase('C4', 'belum', 'kosong', 'Belum ada SO.');
  const vs = masterCustomer?.verification_status;
  if (vs === 'verified') {
    return phase('C4', 'selesai', 'fakta', 'Customer sudah terverifikasi (Master Customer).', { date: masterCustomer.verification_date ?? null });
  }
  if (vs === 'rejected' || vs === 'suspended') {
    return phase('C4', 'gagal', 'fakta', `Verifikasi customer berstatus "${vs}".`);
  }
  if (vs === 'pending_review') {
    return phase('C4', 'proses', 'fakta', 'Verifikasi customer sedang direview.');
  }
  if (vs === 'unverified' || vs === 'dormant' || !vs) {
    // Fallback klaim: kalau SO sudah lanjut jauh (dikirim/ditagih) padahal customer belum
    // terverifikasi, itu sinyal bentrok (gate CV1 seharusnya mencegah, tapi mode shadow).
    const conflict = SO_SHIPPED_CLAIM.has(so.status);
    return phase('C4', 'belum', 'kosong', `Customer belum terverifikasi (status: "${vs || 'tidak ada data'}").`, { conflict });
  }
  return phase('C4', 'belum', 'kosong', `Status verifikasi tidak dikenali: "${vs}".`);
}

/** C5 — SO & PO Customer. Fakta = so.po_status. Fallback klaim = so.status (SO lama sebelum kolom po_status ada). */
function resolveC5(so) {
  if (!so) return phase('C5', 'belum', 'kosong', 'Belum ada SO.');
  const poStatus = so.po_status;
  if (poStatus === 'terverifikasi') {
    return phase('C5', 'selesai', 'fakta', 'PO customer sudah diverifikasi.', { date: so.po_verified_at ?? null, actor: so.po_verified_by ?? null });
  }
  if (poStatus === 'terupload' || poStatus === 'revisi') {
    return phase('C5', 'proses', 'fakta', `PO customer ${poStatus === 'revisi' ? 'perlu revisi' : 'sudah diunggah, menunggu verifikasi'}.`);
  }
  if (poStatus === 'belum_ada' || !poStatus) {
    if (SO_SHIPPED_CLAIM.has(so.status)) {
      return phase('C5', 'belum', 'klaim', `SO berstatus "${so.status}" tapi PO customer belum diunggah.`, { conflict: true });
    }
    return phase('C5', 'belum', 'kosong', 'PO customer belum diunggah.');
  }
  return phase('C5', 'belum', 'kosong', `po_status tidak dikenali: "${poStatus}".`);
}

/** C6 — Pengiriman. Fakta = baris surat_jalan untuk SO ini. Fallback klaim = so.status. */
function resolveC6(so, suratJalanList) {
  if (!so) return phase('C6', 'belum', 'kosong', 'Belum ada SO.');
  const list = (suratJalanList || []).filter((sj) => String(sj.so_customer_id) === String(so.id));
  if (list.length > 0) {
    const anyDelivered = list.some((sj) => SJ_DELIVERED_STATUSES.has(sj.status));
    if (anyDelivered) {
      return phase('C6', 'selesai', 'fakta', `${list.length} Surat Jalan, sudah terkirim/diterima.`);
    }
    const anyInProgress = list.some((sj) => SJ_IN_PROGRESS_STATUSES.has(sj.status));
    if (anyInProgress) return phase('C6', 'proses', 'fakta', `${list.length} Surat Jalan, sedang dalam perjalanan.`);
    return phase('C6', 'proses', 'fakta', `${list.length} Surat Jalan dibuat, belum dikirim.`);
  }
  if (SO_SHIPPED_CLAIM.has(so.status)) {
    return phase('C6', 'proses', 'klaim', `SO berstatus "${so.status}" tapi belum ada Surat Jalan tercatat.`, { conflict: true });
  }
  return phase('C6', 'belum', 'kosong', 'Belum ada Surat Jalan.');
}

/** C7 — Penagihan. Fakta = invoices.status untuk SO ini ('POSTED' vs 'DRAFT'). Fallback klaim = so.status. */
function resolveC7(so, invoices) {
  if (!so) return phase('C7', 'belum', 'kosong', 'Belum ada SO.');
  const list = (invoices || []).filter((inv) => String(inv.so_customer_id) === String(so.id) && inv.status !== 'CANCELLED');
  if (list.length === 0) {
    if (SO_INVOICED_CLAIM.has(so.status)) {
      return phase('C7', 'belum', 'klaim', `SO berstatus "${so.status}" tapi belum ada invoice ditemukan.`, { conflict: true });
    }
    return phase('C7', 'belum', 'kosong', 'Belum ada invoice.');
  }
  const anyPosted = list.some((inv) => inv.status === 'POSTED');
  if (anyPosted) {
    return phase('C7', 'selesai', 'fakta', `${list.length} invoice, sudah ada yang POSTED.`);
  }
  return phase('C7', 'proses', 'fakta', `${list.length} invoice, semua masih DRAFT — belum resmi ditagih ke customer.`);
}

/** C8 — Pelunasan. Fakta = invoices.payment_status/outstanding_amount untuk SO ini. */
function resolveC8(so, invoices) {
  const list = (invoices || []).filter((inv) => String(inv.so_customer_id) === String(so?.id) && inv.status !== 'CANCELLED');
  if (list.length === 0) return phase('C8', 'belum', 'kosong', 'Belum ada invoice untuk dilunasi.');
  const postedList = list.filter((inv) => inv.status === 'POSTED');
  if (postedList.length === 0) return phase('C8', 'belum', 'kosong', 'Invoice belum POSTED, belum bisa dilunasi.');
  const allPaid = postedList.every((inv) => inv.payment_status === 'PAID' || parseFloat(inv.outstanding_amount || 0) <= 0);
  if (allPaid) return phase('C8', 'selesai', 'fakta', `${postedList.length} invoice POSTED, semua lunas.`);
  const anyPartial = postedList.some((inv) => inv.payment_status === 'partial' || (parseFloat(inv.paid_amount || 0) > 0));
  if (anyPartial) return phase('C8', 'proses', 'fakta', `${postedList.length} invoice POSTED, sebagian sudah dibayar.`);
  return phase('C8', 'proses', 'fakta', `${postedList.length} invoice POSTED, belum ada pembayaran.`);
}

/**
 * C9 — Komisi Agen (kondisional). Fakta = pengajuan_anggaran kategori_belanja
 * komisi_external/komisi_internal dengan dynamic_fields.so_id === so.id.
 * Deteksi duplikat: >1 PA aktif (bukan Rejected) dengan agen yang sama untuk SO ini.
 */
function resolveC9(so, komisiPengajuan) {
  const list = (komisiPengajuan || []).filter((pa) => String(pa?.dynamic_fields?.so_id) === String(so?.id));
  if (list.length === 0) return phase('C9', 'belum', 'kosong', 'Tidak ada pengajuan komisi untuk SO ini.');

  const byAgen = new Map();
  for (const pa of list) {
    const agen = (pa?.dynamic_fields?.nama_agen || '').trim().toUpperCase();
    if (!agen) continue;
    if (!byAgen.has(agen)) byAgen.set(agen, []);
    byAgen.get(agen).push(pa);
  }
  const duplicateAgents = [...byAgen.entries()].filter(([, arr]) => arr.filter((p) => p.status !== 'Rejected').length > 1);

  const paidCount = list.filter((pa) => ['Completed', 'Selesai', 'Dibukukan'].includes(pa.status)).length;
  const pendingCount = list.filter((pa) => pa.status === 'Pending').length;

  const summary = `${list.length} pengajuan komisi (${paidCount} selesai, ${pendingCount} pending).`;
  if (duplicateAgents.length > 0) {
    const [agen] = duplicateAgents[0];
    return phase('C9', 'proses', 'fakta', `${summary} Terdeteksi >1 pengajuan aktif untuk agen "${agen}" pada SO ini — cek duplikat.`, { conflict: true });
  }
  if (paidCount === list.length) return phase('C9', 'selesai', 'fakta', summary);
  return phase('C9', 'proses', 'fakta', summary);
}

/**
 * Resolver utama. Tidak melakukan fetch apa pun — semua data sudah harus di-fetch
 * TERPISAH per relasi oleh pemanggil (Aturan #2).
 *
 * @param {object} params
 * @param {object|null} params.so - baris `so_customer`
 * @param {object|null} [params.prospect] - baris `prospects` dengan converted_so_customer_id === so.id (bila ada)
 * @param {object[]} [params.surveys] - baris `sales_survey`
 * @param {object[]} [params.quotations] - baris `quotations`
 * @param {object[]} [params.kalkulatorPenawaran] - baris `kalkulator_penawaran`
 * @param {object|null} [params.masterCustomer] - baris `master_customer` untuk kode_customer SO ini
 * @param {object[]} [params.suratJalan] - baris `surat_jalan`
 * @param {object[]} [params.invoices] - baris `invoices`
 * @param {object[]} [params.komisiPengajuan] - baris `pengajuan_anggaran` kategori_belanja komisi_*
 */
export function resolveCustomerLifecycle({
  so,
  prospect = null,
  surveys = [],
  quotations = [],
  kalkulatorPenawaran = [],
  masterCustomer = null,
  suratJalan = [],
  invoices = [],
  komisiPengajuan = [],
} = {}) {
  const c1 = resolveC1(so, prospect);
  const c2 = resolveC2(so, surveys);
  const c3 = resolveC3(so, quotations, kalkulatorPenawaran);
  const c4 = resolveC4(so, masterCustomer);
  const c5 = resolveC5(so);
  const c6 = resolveC6(so, suratJalan);
  const c7 = resolveC7(so, invoices);
  const c8 = resolveC8(so, invoices);
  const c9 = resolveC9(so, komisiPengajuan);

  const allPhases = [c1, c2, c3, c4, c5, c6, c7, c8, c9];
  // Fase hulu (C1-C3) kondisional: hanya disembunyikan bila kosong DAN tidak conflict.
  // C9 kondisional: hanya tampil bila ada pengajuan komisi (state !== 'belum' setelah fakta ada).
  const visiblePhases = allPhases.filter((p) => {
    if (!p.conditional) return true;
    if (p.id === 'C9') return (komisiPengajuan || []).some((pa) => String(pa?.dynamic_fields?.so_id) === String(so?.id));
    return p.state !== 'belum' || p.conflict;
  });

  const conflicts = allPhases.filter((p) => p.conflict);
  const blockers = allPhases.filter((p) => p.state === 'gagal');

  // Fase saat ini = fase pertama non-kondisional (atau kondisional relevan) yang belum selesai.
  const current = allPhases.find((p) => {
    if (p.conditional) {
      if (p.id === 'C9') return false; // C9 tidak pernah jadi "fase saat ini" (komisi = tindak lanjut, bukan blocker alur utama)
      return false; // C1-C3 hulu tidak memblokir alur utama (99% SO tidak tercatat di sana)
    }
    return p.state !== 'selesai';
  });
  const currentPhaseId = current ? current.id : 'C8';

  return {
    phases: visiblePhases,
    allPhases,
    currentPhaseId,
    conflicts,
    blockers,
  };
}
