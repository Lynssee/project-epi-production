// @ts-nocheck — modul murni berbagi dua repo (project-epi memakai checkJs strict); tipe dijaga lewat tes, bukan JSDoc penuh.
// src/lib/services/inventoryKnowledgeView.js
// Inventory 360° Fase 3 — mengubah profil + template menjadi isi Kartu Pengetahuan per KONTEKS keputusan.
// Modul MURNI (hanya mengimpor konstanta murni) — dites tanpa DOM/Directus.
//
// Kartu = { source: 'item'|'group'|'none', profile: object|null, template: object|null, status: string }
// Konteks: purchase | receive | usage | maintenance | sales  (lihat KNOWLEDGE_CONTEXTS)

// Impor RELATIF (bukan $lib): berkas ini disalin byte-identik ke project-epi (src/lib/services/inventory360/) dan
// dijaga tes kontrak inventory360.contract.test.js. Ubah di sini → salin ke sana.
import { DEFAULT_CONTEXT_MAP, KNOWLEDGE_SECTIONS } from './inventoryKnowledgeDefaults.js';
import { effectiveStatus } from './inventoryKnowledgeScore.js';

const txt = (v) => String(v ?? '').trim();
const arr = (v) => (Array.isArray(v) ? v.map(txt).filter(Boolean) : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** Barang dianggap kritis bila profil menandainya; bila belum ada profil, ikut default template kategori. */
export function isCardKritis(card) {
  if (card?.profile) return !!card.profile.is_kritis;
  return !!card?.template?.is_kritis_default;
}

export function isCardVerified(card) {
  return !!card?.profile && effectiveStatus(card.profile) === 'verified';
}

/** Status tampilan: belum | draft | review | verified | stale. */
export function cardStatus(card) {
  return card?.profile ? effectiveStatus(card.profile) : 'belum';
}

/** Warna penanda kecil di tombol ⓘ: verified (hijau) | unverified (kuning) | none (abu) | danger (merah). */
export function cardIndicator(card) {
  const verified = isCardVerified(card);
  if (!verified && isCardKritis(card)) return 'danger';
  if (verified) return 'verified';
  return card?.profile ? 'unverified' : 'none';
}

/**
 * Peringatan yang perlu dibaca sebelum memutuskan, urut dari paling penting.
 * @returns {Array<{level:'danger'|'warn'|'info', text:string}>}
 */
export function buildCardWarnings(card, context) {
  const out = [];
  const kritis = isCardKritis(card);
  const st = cardStatus(card);
  if (!card?.profile) {
    out.push({
      level: kritis ? 'danger' : 'info',
      text: kritis ? 'Barang KRITIS dan belum punya profil 360°. Jangan putuskan hanya dari nama barang.' : 'Belum ada profil 360° untuk barang ini.'
    });
    return out;
  }
  if (st !== 'verified' && kritis && (context === 'purchase' || context === 'receive')) {
    out.push({ level: context === 'purchase' ? 'danger' : 'warn', text: 'Barang KRITIS tanpa profil terverifikasi — spek di bawah belum bisa dijadikan acuan tunggal.' });
  } else if (st === 'stale') {
    out.push({ level: 'warn', text: 'Profil melewati tanggal tinjau ulang — periksa kembali sebelum dipakai.' });
  } else if (st === 'draft' || st === 'review') {
    out.push({ level: 'warn', text: st === 'review' ? 'Profil menunggu verifikasi.' : 'Profil masih draft.' });
  }
  if (card.profile.sumber_data === 'ai' && st !== 'verified') {
    out.push({ level: 'warn', text: 'Isi dibuat AI dan belum diverifikasi manusia.' });
  }
  if (card.source === 'group') {
    out.push({ level: 'info', text: 'Profil berlaku untuk model ini (semua unit bernomor).' });
  }
  return out;
}

function intervalText(p) {
  const n = Number(p?.interval_ganti?.nilai);
  return n > 0 ? `Ganti setiap ${n} ${txt(p.interval_ganti.satuan) || 'jam'}` : '';
}

function specRows(profile, template) {
  const values = obj(profile?.spec_values);
  const rows = [];
  for (const f of template?.spec_fields || []) {
    const raw = values[f.key];
    const filled = raw !== undefined && raw !== null && txt(raw) !== '';
    if (!filled && !f.wajib && !f.kritis) continue; // field opsional kosong tidak perlu ditampilkan
    let text = '';
    if (filled) text = typeof raw === 'boolean' ? (raw ? 'Ya' : 'Tidak') : `${txt(raw)}${f.unit ? ` ${f.unit}` : ''}`;
    rows.push({ label: f.label || f.key, text: filled ? text : 'belum diisi', kritis: !!f.kritis, missing: !filled });
  }
  return rows;
}

const BUILDERS = {
  identitas: (p) => [
    txt(p.ringkasan) && { label: 'Ringkasan', text: txt(p.ringkasan) },
    txt(p.fungsi_utama) && { label: 'Fungsi', text: txt(p.fungsi_utama) }
  ],
  cara_kerja: (p) => [txt(p.cara_kerja) && { text: txt(p.cara_kerja) }],
  dipakai_pada: (p) => {
    const names = (Array.isArray(p.dipakai_pada) ? p.dipakai_pada : [])
      .map((m) => [txt(m?.nama || m?.kode_grup), txt(m?.catatan)].filter(Boolean).join(' — '))
      .filter(Boolean);
    return [names.length && { label: 'Model', list: names }];
  },
  spesifikasi: (p, t) => specRows(p, t),
  spec_baik: (p) =>
    (Array.isArray(p.spec_baik) ? p.spec_baik : [])
      .filter((r) => txt(r?.param) && txt(r?.target))
      .map((r) => ({ label: txt(r.param), text: [txt(r.target), txt(r.alasan)].filter(Boolean).join(' — ') })),
  panduan_beli: (p) => {
    const b = obj(p.panduan_beli);
    const tier = obj(b.tier_merk);
    const tierText = [['OEM', tier.oem], ['Premium', tier.premium], ['Ekonomis', tier.ekonomis]]
      .filter(([, v]) => txt(v))
      .map(([k, v]) => `${k}: ${txt(v)}`)
      .join(' · ');
    return [
      arr(b.wajib_cek).length && { label: 'Wajib dicek', list: arr(b.wajib_cek) },
      arr(b.hindari).length && { label: 'Hindari', list: arr(b.hindari) },
      tierText && { label: 'Tier merk', text: tierText },
      arr(b.tanda_palsu).length && { label: 'Tanda barang palsu', list: arr(b.tanda_palsu), warn: true },
      arr(b.cross_ref_part_no).length && { label: 'Padanan part number', list: arr(b.cross_ref_part_no) }
    ];
  },
  panduan_pakai: (p) => {
    const u = obj(p.panduan_pakai);
    return [
      txt(u.cara_pasang) && { label: 'Cara pasang/pakai', text: txt(u.cara_pasang) },
      intervalText(u) && { label: 'Interval', text: intervalText(u) },
      arr(u.tanda_harus_ganti).length && { label: 'Tanda harus diganti', list: arr(u.tanda_harus_ganti) },
      arr(u.kesalahan_umum).length && { label: 'Kesalahan umum', list: arr(u.kesalahan_umum), warn: true }
    ];
  },
  risiko: (p) => [txt(p.risiko_salah) && { text: txt(p.risiko_salah), warn: true }],
  keputusan: (p) => {
    const d = obj(p.decision_rules);
    return [
      txt(d.perbaiki_vs_ganti) && { label: 'Perbaiki vs ganti', text: txt(d.perbaiki_vs_ganti) },
      txt(d.substitusi_aman) && { label: 'Substitusi aman', text: txt(d.substitusi_aman) },
      txt(d.kapan_eskalasi) && { label: 'Kapan eskalasi', text: txt(d.kapan_eskalasi) }
    ];
  },
  k3_simpan: (p) => [
    arr(p.apd).length && { label: 'APD', list: arr(p.apd) },
    txt(p.bahaya) && { label: 'Bahaya', text: txt(p.bahaya), warn: true }
  ]
};

/** Daftar section yang tampil untuk sebuah konteks: context_map template → fallback bawaan, disaring section aktif. */
export function sectionsForContext(template, context) {
  const mapped = template?.context_map?.[context];
  const base = Array.isArray(mapped) ? mapped : DEFAULT_CONTEXT_MAP[context] || [];
  const aktif = Array.isArray(template?.sections_aktif) && template.sections_aktif.length ? template.sections_aktif : null;
  const wanted = aktif ? base.filter((s) => aktif.includes(s)) : base;
  // urutan tampil mengikuti urutan katalog section, bukan urutan centang
  return KNOWLEDGE_SECTIONS.map((s) => s.key).filter((k) => wanted.includes(k) && BUILDERS[k]);
}

/**
 * Blok isi kartu untuk satu konteks. Blok tanpa isi dibuang.
 * @returns {Array<{key:string, title:string, rows:Array<{label?:string,text?:string,list?:string[],warn?:boolean,kritis?:boolean,missing?:boolean}>}>}
 */
export function buildCardBlocks(card, context) {
  if (!card?.profile) return [];
  const titles = Object.fromEntries(KNOWLEDGE_SECTIONS.map((s) => [s.key, s.label]));
  const blocks = [];
  for (const key of sectionsForContext(card.template, context)) {
    const rows = BUILDERS[key](card.profile, card.template).filter(Boolean);
    if (rows.length) blocks.push({ key, title: titles[key], rows });
  }
  return blocks;
}

export const SPEC_GATE_REASON_TEXT = Object.freeze({
  tanpa_profil: 'barang kritis tanpa profil 360°',
  belum_terverifikasi: 'barang kritis dengan profil belum terverifikasi',
  kedaluwarsa: 'barang kritis dengan profil melewati tanggal tinjau ulang'
});

/**
 * Evaluator murni gate G_INV_SPEC_PURCHASE / G_INV_SPEC_RECEIVE: SETIAP barang KRITIS wajib punya profil terverifikasi.
 * Barang non-kritis tidak dievaluasi. (Checklist inspeksi terima yang interaktif belum ada — baru kesiapan datanya.)
 * @param {Array<{itemId:number, nama?:string, card:object|null}>} entries
 * @returns {{ evaluated:number, passed:number, failed:Array<{itemId:number, nama:string, reason:string, text:string}> }}
 */
export function evaluateSpecGate(entries) {
  let evaluated = 0;
  let passed = 0;
  const failed = [];
  for (const e of entries || []) {
    if (!isCardKritis(e?.card)) continue;
    evaluated += 1;
    if (isCardVerified(e.card)) {
      passed += 1;
      continue;
    }
    const st = cardStatus(e.card);
    const reason = !e.card?.profile ? 'tanpa_profil' : st === 'stale' ? 'kedaluwarsa' : 'belum_terverifikasi';
    failed.push({ itemId: e.itemId, nama: txt(e.nama), reason, text: SPEC_GATE_REASON_TEXT[reason] });
  }
  return { evaluated, passed, failed };
}

/**
 * Baris spek untuk DOKUMEN CETAK yang dikirim ke supplier (PO / RFQ).
 * Aturan: hanya dari profil TERVERIFIKASI (spek belum diperiksa tidak boleh jadi permintaan resmi), hanya field
 * wajib/kritis yang terisi, plus padanan part number. Sengaja TIDAK memuat tier merk, tanda palsu, risiko, atau
 * apa pun yang bersifat internal.
 * @returns {{spek:string[], padanan:string[]}|null} null bila tak ada yang layak dicetak
 */
export function buildPrintSpecLines(card) {
  if (!isCardVerified(card)) return null;
  const values = obj(card.profile.spec_values);
  const spek = [];
  for (const f of card.template?.spec_fields || []) {
    if (!f?.wajib && !f?.kritis) continue;
    const raw = values[f.key];
    if (raw === undefined || raw === null || txt(raw) === '') continue;
    const val = typeof raw === 'boolean' ? (raw ? 'Ya' : 'Tidak') : `${txt(raw)}${f.unit ? ` ${f.unit}` : ''}`;
    spek.push(`${f.label || f.key}: ${val}`);
  }
  const padanan = arr(obj(card.profile.panduan_beli).cross_ref_part_no);
  return spek.length || padanan.length ? { spek, padanan } : null;
}

/** Ringkasan harga dari daftar harga satuan histori PO. Null bila tak ada data valid. */
export function summarizePrices(prices) {
  const v = (prices || []).map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return { n: v.length, min: v[0], median, max: v[v.length - 1] };
}
