// @ts-nocheck — modul murni berbagi dua repo (project-epi memakai checkJs strict); tipe dijaga lewat tes, bukan JSDoc penuh.
// src/lib/services/inventoryKnowledgeDefaults.js
// Inventory 360° Knowledge Hub (Fase 1) — katalog section, konteks keputusan, dan template bawaan.
// Modul MURNI (tanpa import) — aman di klien & tes. Sumber kebenaran runtime tetap koleksi
// `inventory_knowledge_template` (diatur superadmin di /settings/inventory-knowledge); isi file ini hanya
// (a) daftar section/konteks yang dikenali kode, dan (b) bahan "Buat template bawaan" agar tidak mulai dari nol.

/** Section profil 360°. `key` dipakai di template.sections_aktif & template.context_map. */
export const KNOWLEDGE_SECTIONS = Object.freeze([
  { key: 'identitas', label: 'Identitas & fungsi', hint: 'Ringkasan satu kalimat dan fungsi utama barang — apa ini dan untuk apa.' },
  { key: 'cara_kerja', label: 'Cara kerja', hint: 'Prinsip kerja singkat agar pembeli/mekanik paham mengapa spek tertentu penting.' },
  { key: 'dipakai_pada', label: 'Dipakai pada', hint: 'Model equipment tempat part ini dipasang (tertaut ke grup model).' },
  { key: 'spesifikasi', label: 'Spesifikasi kunci', hint: 'Nilai untuk field spek dari template — yang bertanda kritis wajib benar saat membeli.' },
  { key: 'spec_baik', label: 'Spek yang baik', hint: 'Parameter, target, dan alasannya — standar penilaian "barang ini layak".' },
  { key: 'panduan_beli', label: 'Panduan beli', hint: 'Wajib dicek, yang dihindari, tier merk, tanda barang palsu, padanan part number.' },
  { key: 'panduan_pakai', label: 'Panduan pakai', hint: 'Cara pasang, interval ganti, tanda harus ganti, kesalahan umum.' },
  { key: 'risiko', label: 'Dampak jika salah', hint: 'Akibat bila barang salah dipilih atau salah dipakai.' },
  { key: 'keputusan', label: 'Aturan keputusan', hint: 'Perbaiki vs ganti, substitusi aman, kapan eskalasi.' },
  { key: 'k3_simpan', label: 'K3 & penyimpanan', hint: 'APD, bahaya, kondisi simpan, umur simpan.' },
  { key: 'media', label: 'Media', hint: 'Foto, diagram, manual, video.' },
  { key: 'training', label: 'Training', hint: 'Modul belajar 5 menit dan status wajib training.' }
]);

/** Konteks keputusan tempat Kartu 360° muncul. */
export const KNOWLEDGE_CONTEXTS = Object.freeze([
  { key: 'purchase', label: 'Pembelian (PR / RFQ / PO / direct purchase)', hint: 'Membantu memutuskan beli apa & spek mana.' },
  { key: 'receive', label: 'Penerimaan (GRN / inspeksi proyek)', hint: 'Membantu memutuskan terima atau tolak barang.' },
  { key: 'usage', label: 'Pemakaian (BK / scan QR)', hint: 'Memastikan barang benar untuk unit benar.' },
  { key: 'maintenance', label: 'Maintenance (perbaikan / PM / P2H)', hint: 'Interval ganti, perbaiki vs ganti, substitusi.' },
  { key: 'sales', label: 'Penjualan / penawaran', hint: 'Rekomendasi penggunaan untuk edukasi customer.' }
]);

export const SPEC_FIELD_TYPES = Object.freeze(['teks', 'angka', 'pilihan', 'ya_tidak']);

export const SECTION_KEYS = KNOWLEDGE_SECTIONS.map((s) => s.key);
export const CONTEXT_KEYS = KNOWLEDGE_CONTEXTS.map((c) => c.key);

/** context_map bawaan: section apa yang tampil di konteks mana (ringkas di popover, lengkap di drawer 360°). */
export const DEFAULT_CONTEXT_MAP = Object.freeze({
  purchase: ['identitas', 'spesifikasi', 'spec_baik', 'panduan_beli'],
  receive: ['spesifikasi', 'panduan_beli'],
  usage: ['dipakai_pada', 'panduan_pakai', 'k3_simpan'],
  maintenance: ['dipakai_pada', 'panduan_pakai', 'keputusan'],
  sales: ['identitas', 'spesifikasi', 'panduan_pakai']
});

const f = (key, label, extra = {}) => ({ key, label, unit: '', tipe: 'teks', wajib: false, kritis: false, hint: '', ...extra });

/**
 * Template bawaan per kelompok kategori. `cocok` dicocokkan (huruf besar, substring) ke nama parent_category,
 * sehingga tidak bergantung pada ID. Hanya parent yang ada di Directus yang dibuat.
 */
export const DEFAULT_TEMPLATES = Object.freeze([
  {
    cocok: 'SPAREPART',
    nama: 'Sparepart',
    is_kritis_default: false,
    min_score_verified: 70,
    spec_fields: [
      f('part_number_oem', 'Part number OEM', { wajib: true, kritis: true, hint: 'Nomor part dari pabrikan alat — acuan utama cross-reference.' }),
      f('merk_oem', 'Merk OEM / pembuat'),
      f('material', 'Material / media'),
      f('dimensi', 'Dimensi', { hint: 'Contoh: OD × ID × T, atau ukuran ulir.' }),
      f('kapasitas_kerja', 'Kapasitas / rating kerja', { kritis: true, hint: 'Tekanan, flow, atau beban maksimum yang harus dipenuhi.' }),
      f('kompatibel_model', 'Kompatibel dengan model', { hint: 'Cukup ringkas; tautan model lengkap di section "Dipakai pada".' }),
      f('part_number_alternatif', 'Part number alternatif', { hint: 'Cross-reference cepat bila OEM kosong (mis. DFBLAST, aftermarket).' }),
      f('posisi_assembly', 'Posisi assembly', { tipe: 'pilihan', opsi: ['Air End', 'Nozzle', 'Seal Kit', 'Filter', 'Lainnya'] }),
      f('tipe_ulir_koneksi', 'Tipe ulir / koneksi', { tipe: 'pilihan', opsi: ['NPT', 'BSP', 'Flange', 'Quick coupling', 'Lainnya'], hint: 'Salah ulir = tidak terpasang / bocor.' })
    ]
  },
  {
    cocok: 'EQUIPMENT',
    nama: 'Equipment (model)',
    is_kritis_default: false,
    min_score_verified: 70,
    spec_fields: [
      f('kapasitas', 'Kapasitas', { wajib: true, kritis: true }),
      f('daya', 'Daya', { unit: 'kW / HP' }),
      f('sumber_tenaga', 'Sumber tenaga', { tipe: 'pilihan', opsi: ['Listrik', 'Bensin', 'Solar', 'Pneumatik', 'Manual'] }),
      f('dimensi', 'Dimensi'),
      f('berat', 'Berat', { tipe: 'angka', unit: 'kg' }),
      f('interval_servis', 'Interval servis berkala', { tipe: 'angka', unit: 'jam', hint: 'Dipakai pengingat PM otomatis (Fase rekomendasi).' }),
      f('tekanan_kerja_bar', 'Tekanan kerja', { unit: 'bar / psi', hint: 'Penting untuk compressor & airless pump.' }),
      f('debit_aliran', 'Debit aliran', { unit: 'CFM / L/menit' }),
      f('spesifikasi_oli_fluida', 'Spesifikasi oli / fluida', { kritis: true, hint: 'Jenis oli, grease, filter bawaan pabrikan — mencegah salah isi.' }),
      f('kapasitas_oli_l', 'Kapasitas oli', { tipe: 'angka', unit: 'L' }),
      f('konsumsi_bbm_l_jam', 'Konsumsi BBM', { tipe: 'angka', unit: 'L/jam', hint: 'Acuan audit BBM pada P2H.' }),
      f('wajib_sertifikat_disnaker', 'Wajib sertifikat Disnaker', { tipe: 'ya_tidak', kritis: true, hint: 'Mis. compressor / bejana tekan (riksa uji).' }),
      f('interval_riksa_uji_bulan', 'Interval riksa uji', { tipe: 'angka', unit: 'bulan', hint: 'Masa berlaku SLO / suket Disnaker.' })
    ]
  },
  {
    cocok: 'CONSUMABLE',
    nama: 'Consumable',
    is_kritis_default: false,
    min_score_verified: 60,
    spec_fields: [
      f('ukuran_grade', 'Ukuran / grade', { wajib: true, hint: 'Mis. grit, mesh, ketebalan.' }),
      f('kemasan', 'Kemasan'),
      f('standar', 'Standar / sertifikasi'),
      f('umur_simpan', 'Umur simpan', { tipe: 'angka', unit: 'hari' }),
      f('consumption_rate', 'Laju konsumsi', { hint: 'Mis. kg/m² (abrasive) atau m²/pcs.' }),
      f('reusable_cycles', 'Siklus pakai ulang', { tipe: 'angka', unit: 'kali' }),
      f('material_dasar', 'Material dasar')
    ]
  },
  {
    cocok: 'INSPEKSI',
    alias: ['INPEKSI'], // ejaan di master parent_category live (id 131) salah ketik
    nama: 'Alat inspeksi & ukur',
    is_kritis_default: true,
    min_score_verified: 80,
    spec_fields: [
      f('rentang_ukur', 'Rentang ukur', { wajib: true, kritis: true }),
      f('akurasi', 'Akurasi / resolusi', { wajib: true, kritis: true }),
      f('interval_kalibrasi', 'Interval kalibrasi', { tipe: 'angka', unit: 'bulan', wajib: true }),
      f('sertifikat_kalibrasi', 'Wajib sertifikat kalibrasi', { tipe: 'ya_tidak' }),
      f('standar_acuan', 'Standar acuan', { hint: 'ISO / ASTM / SSPC yang dirujuk alat.' }),
      f('tipe_probe_sensor', 'Tipe probe / sensor', { tipe: 'pilihan', opsi: ['Ferrous', 'Non-Ferrous', 'Dual (F/NF)', 'Lainnya'] }),
      f('toleransi_kalibrasi', 'Toleransi kalibrasi')
    ]
  },
  {
    cocok: 'ELECTRICAL',
    nama: 'Electrical',
    is_kritis_default: false,
    min_score_verified: 70,
    spec_fields: [
      f('tegangan', 'Tegangan', { unit: 'V', kritis: true }),
      f('arus', 'Arus / kapasitas', { unit: 'A', kritis: true }),
      f('standar', 'Standar (SNI / IEC)'),
      f('ip_rating', 'IP rating')
    ]
  },
  {
    cocok: 'SAFETY',
    nama: 'Safety & APD',
    is_kritis_default: true,
    min_score_verified: 80,
    spec_fields: [
      f('standar', 'Standar (SNI / EN / ANSI)', { wajib: true, kritis: true }),
      f('ukuran', 'Ukuran tersedia'),
      f('masa_pakai', 'Masa pakai', { tipe: 'angka', unit: 'bulan' }),
      f('sertifikasi', 'Sertifikasi wajib', { tipe: 'ya_tidak', kritis: true })
    ]
  },
  {
    cocok: 'FINISHGOOD',
    alias: ['FINISH'],
    nama: 'Finish Good (cat & coating)',
    is_kritis_default: false,
    sections_aktif: SECTION_KEYS.filter((s) => s !== 'dipakai_pada'),
    min_score_verified: 70,
    spec_fields: [
      f('jenis_produk', 'Jenis produk', { wajib: true, hint: 'Mis. epoxy primer, polyurethane topcoat, zinc rich.' }),
      f('volume_kemasan', 'Volume kemasan'),
      f('solid_volume', 'Solid by volume', { tipe: 'angka', unit: '%', kritis: true }),
      f('dft', 'DFT per lapis', { unit: 'µm', kritis: true, hint: 'Tebal film kering yang disyaratkan per lapis.' }),
      f('daya_sebar', 'Daya sebar teoritis', { unit: 'm²/L', kritis: true }),
      f('rasio_campuran', 'Rasio campuran (A:B)', { wajib: true, kritis: true }),
      f('pot_life', 'Pot life', { unit: 'jam', kritis: true, hint: 'Batas waktu pakai setelah dicampur, pada suhu acuan.' }),
      f('waktu_kering', 'Waktu kering sentuh / keras', { kritis: true }),
      f('recoat_window', 'Jendela overcoat (min–maks)', { kritis: true, hint: 'Isi dari TDS resmi, bukan perkiraan.' }),
      f('thinner', 'Thinner & rasio maksimum', { kritis: true }),
      f('metode_aplikasi', 'Metode Aplikasi', { hint: 'Airless spray, conventional spray, roll, kuas.' }),
      f('sistem_komponen', 'Sistem komponen', { tipe: 'pilihan', opsi: ['1K', '2K', '3K'] }),
      f('surface_preparation', 'Persiapan permukaan', { kritis: true, hint: 'Mis. Sa 2.5, St 3, atau CSP 3 (beton).' }),
      f('wft_micron', 'WFT target', { unit: 'µm', hint: 'Tebal basah acuan untuk tukang spray.' }),
      f('voc_g_per_l', 'VOC', { tipe: 'angka', unit: 'g/L', hint: 'Syarat proyek migas / TKDN / green building.' }),
      f('ketahanan_suhu_c', 'Ketahanan suhu', { unit: '°C' }),
      f('ketahanan_kimia', 'Ketahanan kimia', { hint: 'Asam / alkali / solvent / air laut.' }),
      f('padanan_kompetitor', 'Padanan kompetitor', { hint: 'Dari tabel padanan Jotun / Hempel / IP — untuk sales & tender.' })
    ]
  },
  {
    cocok: 'RAW MATERIAL',
    alias: ['RAW'],
    nama: 'Raw Material (bahan baku & kimia)',
    is_kritis_default: true,
    sections_aktif: SECTION_KEYS.filter((s) => s !== 'dipakai_pada'),
    min_score_verified: 70,
    spec_fields: [
      f('cas_number', 'CAS number', { wajib: true, kritis: true, hint: 'Nomor registrasi CAS bahan kimia untuk identifikasi bahaya dan MSDS.' }),
      f('grade', 'Grade / kemurnian', { wajib: true }),
      f('viskositas', 'Viskositas (@25°C)', { unit: 'mPa.s', hint: 'Viskositas cairan atau pengenceran acuan lab.' }),
      f('solid_content', 'Kadar Padatan / Solid content', { tipe: 'angka', unit: '%', kritis: true }),
      f('density', 'Berat Jenis / Densitas', { unit: 'g/cm³', hint: 'Specific gravity @ 20°/25°C.' }),
      f('flash_point', 'Flash point', { tipe: 'angka', unit: '°C', kritis: true, hint: 'Titik nyala api bahan cair/solvent.' }),
      f('acid_amine_value', 'Acid / Amine / EEW Value', { unit: 'mg KOH/g / g/eq', hint: 'Nilai bilangan asam, amina, atau EEW resin.' }),
      f('kondisi_simpan', 'Kondisi simpan', { hint: 'Suhu penyimpanan maksimum, kelembaban, ventilasi ruangan.' }),
      f('umur_simpan', 'Umur simpan', { tipe: 'angka', unit: 'hari', kritis: true, hint: 'Masa simpan sebelum kedaluwarsa atau menggumpal.' }),
      f('rekomendasi_apd', 'Rekomendasi APD Handling', { kritis: true, hint: 'Respirator, kacamata goggle, sarung tangan nitril/butyl.' }),
      f('pelarut_pembawa', 'Pelarut pembawa', { hint: 'Xylene / MPA / air — mencegah salah campur solvent.' }),
      f('incompatibilities', 'Incompatibilities', { kritis: true, hint: 'Bahan yang memicu reaksi eksotermik/gel bila tercampur (MSDS Sec. 10).' }),
      f('klasifikasi_ghs_un', 'Klasifikasi GHS / UN', { hint: 'UN number, packing group, hazard class (MSDS Sec. 14).' })
    ]
  },
  {
    cocok: 'HARDENER',
    nama: 'Hardener (pengeras)',
    is_kritis_default: true,
    sections_aktif: SECTION_KEYS.filter((s) => s !== 'dipakai_pada'),
    min_score_verified: 70,
    spec_fields: [
      f('grade', 'Grade / tipe', { wajib: true }),
      f('acid_amine_value', 'Amine / EEW value', { unit: 'mg KOH/g / g/eq', kritis: true, hint: 'Dasar hitung stoikiometri resin vs hardener.' }),
      f('solid_content', 'Kadar padatan', { tipe: 'angka', unit: '%' }),
      f('flash_point', 'Flash point', { tipe: 'angka', unit: '°C', kritis: true }),
      f('viskositas', 'Viskositas (@25°C)', { unit: 'mPa.s' }),
      f('umur_simpan', 'Umur simpan', { tipe: 'angka', unit: 'hari', kritis: true }),
      f('incompatibilities', 'Incompatibilities', { kritis: true }),
      f('rekomendasi_apd', 'Rekomendasi APD', { kritis: true })
    ]
  },
  { cocok: 'PRODUKSI', nama: 'Bahan / alat produksi', is_kritis_default: false, min_score_verified: 60, spec_fields: [f('ukuran_grade', 'Ukuran / grade', { wajib: true }), f('standar', 'Standar'), f('kemasan', 'Kemasan')] },
  { cocok: 'KENDARAAN', nama: 'Kendaraan & part kendaraan', is_kritis_default: false, min_score_verified: 60, spec_fields: [f('tipe_kendaraan', 'Tipe / model kendaraan', { wajib: true }), f('nomor_part', 'Nomor part', { kritis: true }), f('spesifikasi_oli_fluida', 'Spesifikasi oli / fluida', { kritis: true })] },
  { cocok: 'ATK', alias: ['ATK & RTK'], nama: 'ATK & RTK', is_kritis_default: false, min_score_verified: 50, spec_fields: [f('ukuran_grade', 'Ukuran / tipe', { wajib: true }), f('kemasan', 'Kemasan')] },
  { cocok: 'BANGUNAN', nama: 'Material bangunan', is_kritis_default: false, min_score_verified: 60, spec_fields: [f('ukuran_grade', 'Ukuran / grade', { wajib: true }), f('standar', 'Standar (SNI)'), f('material_dasar', 'Material dasar')] },
  { cocok: 'TECHNOLOGY', nama: 'Technology / IT', is_kritis_default: false, min_score_verified: 60, spec_fields: [f('merk_tipe', 'Merk & tipe', { wajib: true }), f('spesifikasi_teknis', 'Spesifikasi teknis'), f('garansi', 'Garansi')] }
]);

/**
 * Validasi template sebelum disimpan. Mengembalikan daftar pesan error (kosong = valid).
 * @param {{nama?:string, spec_fields?:any[], sections_aktif?:string[], context_map?:Record<string,string[]>, min_score_verified?:number, parent_category_id?:number|null, sub_category_id?:number|null}} t
 * @returns {string[]}
 */
export function validateKnowledgeTemplate(t) {
  const errors = [];
  if (!String(t?.nama ?? '').trim()) errors.push('Nama template wajib diisi.');
  if (t?.parent_category_id == null && t?.sub_category_id == null) {
    errors.push('Pilih cakupan: kategori induk atau sub-kategori.');
  }

  const score = Number(t?.min_score_verified);
  if (!Number.isFinite(score) || score < 0 || score > 100) errors.push('Ambang skor harus 0–100.');

  const seen = new Set();
  for (const [i, fld] of (t?.spec_fields || []).entries()) {
    const n = i + 1;
    const key = String(fld?.key ?? '').trim();
    if (!key) errors.push(`Field spek #${n}: kunci wajib diisi.`);
    else if (!/^[a-z][a-z0-9_]*$/.test(key)) errors.push(`Field spek #${n}: kunci "${key}" harus huruf kecil/angka/underscore dan diawali huruf.`);
    else if (seen.has(key)) errors.push(`Field spek #${n}: kunci "${key}" duplikat.`);
    seen.add(key);
    if (!String(fld?.label ?? '').trim()) errors.push(`Field spek #${n}: label wajib diisi.`);
    if (!SPEC_FIELD_TYPES.includes(fld?.tipe)) errors.push(`Field spek #${n}: tipe tidak dikenal.`);
    if (fld?.tipe === 'pilihan' && !(fld?.opsi || []).filter((o) => String(o).trim()).length) {
      errors.push(`Field spek #${n}: tipe pilihan butuh minimal 1 opsi.`);
    }
  }

  for (const s of t?.sections_aktif || []) {
    if (!SECTION_KEYS.includes(s)) errors.push(`Section "${s}" tidak dikenal.`);
  }
  for (const [ctx, secs] of Object.entries(t?.context_map || {})) {
    if (!CONTEXT_KEYS.includes(ctx)) errors.push(`Konteks "${ctx}" tidak dikenal.`);
    for (const s of secs || []) {
      if (!SECTION_KEYS.includes(s)) errors.push(`Konteks "${ctx}": section "${s}" tidak dikenal.`);
    }
  }
  return errors;
}

/**
 * Pilih template untuk sebuah barang: sub-kategori menimpa parent. Hanya template berstatus aktif.
 * @returns {object|null}
 */
export function resolveKnowledgeTemplate(templates, { parentCategoryId, subCategoryId }) {
  const aktif = (templates || []).filter((t) => (t?.status ?? 'active') === 'active');
  if (subCategoryId != null) {
    const bySub = aktif.find((t) => t.sub_category_id === subCategoryId);
    if (bySub) return bySub;
  }
  if (parentCategoryId != null) {
    return aktif.find((t) => t.parent_category_id === parentCategoryId && t.sub_category_id == null) || null;
  }
  return null;
}

/** Template bawaan siap-simpan untuk sebuah parent kategori (tanpa id). */
export function buildDefaultTemplatePayload(def, parentCategoryId) {
  return {
    nama: def.nama,
    parent_category_id: parentCategoryId,
    sub_category_id: null,
    spec_fields: def.spec_fields.map((x) => ({ ...x })),
    sections_aktif: def.sections_aktif ? [...def.sections_aktif] : [...SECTION_KEYS],
    context_map: Object.fromEntries(Object.entries(DEFAULT_CONTEXT_MAP).map(([k, v]) => [k, [...v]])),
    min_score_verified: def.min_score_verified,
    is_kritis_default: def.is_kritis_default,
    status: 'active'
  };
}

/**
 * Field spek bawaan yang BELUM ada di template yang sudah tersimpan (dicocokkan lewat `key`).
 * Hanya menambah — tidak pernah mengubah/menghapus field yang sudah disunting superadmin.
 * @returns {any[]} field baru (salinan), kosong bila template sudah lengkap
 */
export function missingDefaultSpecFields(existingTemplate, def) {
  const ada = new Set((existingTemplate?.spec_fields || []).map((x) => x?.key));
  return (def?.spec_fields || []).filter((x) => !ada.has(x.key)).map((x) => ({ ...x }));
}
