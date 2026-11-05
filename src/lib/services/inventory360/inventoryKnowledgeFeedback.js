// @ts-nocheck — modul murni berbagi dua repo (project-epi memakai checkJs strict); tipe dijaga lewat tes, bukan JSDoc penuh.
// src/lib/services/inventoryKnowledgeFeedback.js
// Inventory 360° Fase B — laporan lapangan "Data spek berbeda dengan barang fisik".
// Modul MURNI (tanpa import) — dipakai kartu lapangan (project-epi), banner admin (erp-epi), dan tes.
// Laporan TIDAK mengubah status profil (satu salah-ketuk di lapangan tidak boleh menarik profil terverifikasi / program training);
// laporan hanya memunculkan banner & antrean tinjauan di dashboard admin, dan admin yang memutuskan.

export const FEEDBACK_COLLECTION = 'inventory_knowledge_feedback';

export const FEEDBACK_KINDS = Object.freeze([
  { key: 'ukuran', label: 'Ukuran / dimensi berbeda' },
  { key: 'merk_part', label: 'Merk / part number berbeda' },
  { key: 'label', label: 'Kemasan / label / spesifikasi tertera berbeda' },
  { key: 'kualitas', label: 'Kondisi / kualitas mencurigakan' },
  { key: 'lainnya', label: 'Lainnya' }
]);
export const FEEDBACK_KIND_KEYS = FEEDBACK_KINDS.map((k) => k.key);
export const FEEDBACK_STATUSES = Object.freeze(['open', 'selesai', 'ditolak']);

export const FEEDBACK_NOTE_MAX = 500;
/** Catatan wajib bila jenis 'lainnya' (tanpa catatan laporannya tidak bisa ditindaklanjuti). */
export const FEEDBACK_NOTE_MIN_OTHER = 10;

/** @returns {string[]} daftar pesan error (kosong = valid) */
export function validateFeedback(f) {
  const errors = [];
  const itemId = Number(f?.itemId);
  if (!Number.isFinite(itemId) || itemId <= 0) errors.push('Barang tidak valid.');
  if (!FEEDBACK_KIND_KEYS.includes(f?.jenis)) errors.push('Pilih jenis ketidaksesuaian.');
  const note = String(f?.catatan ?? '').trim();
  if (note.length > FEEDBACK_NOTE_MAX) errors.push(`Catatan maksimal ${FEEDBACK_NOTE_MAX} karakter.`);
  if (f?.jenis === 'lainnya' && note.length < FEEDBACK_NOTE_MIN_OTHER) errors.push(`Jelaskan di catatan (minimal ${FEEDBACK_NOTE_MIN_OTHER} karakter).`);
  return errors;
}

/**
 * Baris siap POST. Tidak melempar; panggil validateFeedback dulu.
 * @param {{ itemId: number|string, profileId?: number|string|null, jenis: string, catatan?: string, konteks?: string|null, pelaporEmail?: string|null }} p
 */
export function buildFeedbackRow({ itemId, profileId = null, jenis, catatan = '', konteks = null, pelaporEmail = null }) {
  return {
    item_id: Number(itemId),
    profile_id: profileId != null && Number.isFinite(Number(profileId)) ? Number(profileId) : null,
    jenis,
    catatan: String(catatan ?? '').trim().slice(0, FEEDBACK_NOTE_MAX) || null,
    konteks: konteks ? String(konteks).slice(0, 32) : null,
    pelapor_email: pelaporEmail ? String(pelaporEmail).slice(0, 255) : null,
    status: 'open'
  };
}

/** Kunci dedupe sesi: pelapor yang sama tidak mengirim laporan yang sama (barang + jenis) berulang kali. */
export const feedbackDedupeKey = (itemId, jenis) => `${Number(itemId)}|${jenis}`;

export const feedbackKindLabel = (key) => FEEDBACK_KINDS.find((k) => k.key === key)?.label || key || '—';

/** Ringkas daftar laporan terbuka per barang → Map<itemId, jumlah>. */
export function countOpenByItem(rows) {
  const m = new Map();
  for (const r of rows || []) {
    if (r?.status && r.status !== 'open') continue;
    const id = Number(r?.item_id);
    if (!Number.isFinite(id)) continue;
    m.set(id, (m.get(id) || 0) + 1);
  }
  return m;
}
