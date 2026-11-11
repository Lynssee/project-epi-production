// @ts-nocheck
// src/lib/utils/spkDocument.js
// Mesin dokumen SPK Manpower — MURNI (tanpa DOM/Directus) agar bisa diuji unit.
// Dua varian, mengikuti PDF contoh riil:
//   • harian   → "Surat Perintah Kerja" (PI031 - Sugeng Wijaya)
//   • borongan → "Surat Tugas" 6 Pasal + Tata Tertib Subcont (LO-PI097 - Irpan Nurdiawan)
// Teks hukum bersumber dari PDF; yang diubah hanya cacat mekanis (lihat rencana §3.1).
// Semua angka/teks yang bisa berubah ada di SPK_DEFAULTS dan dapat ditimpa lewat
// setelan manpower.spk_doc.* (manpowerSettings.js) — lihat mergeSpkSettings().

/* ───────────────────────── Default (fallback bila setelan kosong) ───────────────────────── */

export const SPK_DEFAULTS = {
  retensi_pct: 5,
  retensi_hari: 30,
  pph21_pct: 2.5,
  // TTD manpower via tautan (Fase 4). Default MATI sampai skema Directus di-apply Lead.
  ttd_link_aktif: false,
  otp_wajib: true,
  link_ttl_hari: 7,
  // Gate G_SPK_MANPOWER_TTD (Fase 5): jenis yang diperiksa & tanggal berlaku (SPK terbit sebelumnya dikecualikan). Mode di Kalibrasi Gate.
  gate_jenis: 'borongan',
  // Pengingat otomatis TTD (Fase 6, dipicu n8n). Default MATI; butuh ttd_link_aktif juga.
  reminder_aktif: false,
  // Rincian borongan per item (kolom manpower_assignment.borongan_items). Default MATI sampai skema di-apply Lead.
  borongan_items_aktif: false,
  // SPK Harian/perorangan: true = format berpasal (Pihak Pertama/Kedua + Pasal I–VI + lampiran tata tertib); false = format ringkas 1 halaman (PDF PI031).
  harian_dengan_pasal: true,
  reminder_h_min: 3,
  reminder_maks: 5,
  reminder_interval_jam: 24,
  reminder_template: 'Pengingat: SPK Anda untuk proyek {proyek} belum ditandatangani. Mohon dibaca lalu ditandatangani lewat tautan ini:\n{link}\n\n(Tautan baru, berlaku {hari} hari. Abaikan pesan ini bila sudah menandatangani.)',
  gate_berlaku_sejak: '2026-11-10',
  // Gate level PROYEK (kasbon transport/mobilisasi tanpa rincian penugasan): kode kategori anggaran yang ikut diperiksa
  // (kosong = nonaktif) dan jendela hari — hanya SPK yang mulai kerja dalam N hari yang dihitung.
  gate_kategori_proyek: 'mobilisasi',
  gate_horizon_hari: 3,
  wa_template: 'Halo {nama}, berikut {dokumen} untuk proyek {proyek}. Mohon dibaca lalu ditandatangani lewat tautan ini:\n{link}\n\n(Tautan berlaku {hari} hari. Jangan bagikan tautan ini ke siapa pun.)',
  jam_kerja: 'Hari Senin s/d Minggu : Jam 07.00 s/d 17.00, istirahat jam 12.00 s/d 13.00',
  harian_siklus_bayar: '14 hari sekali di hari Jumat',
  kontrakan_skema: 'dibagi 2',
  kota_surat: 'Bogor',
  alamat_perusahaan: 'Jl Raya Parpostel, Gang Nangka No.88, RT02/03, Bojongkulur, Gunung Putri, Kab. Bogor 16969',
  // Nama penandatangan (kosong = garis tanda tangan kosong). Diisi dari UI setelan.
  ttd_admin_nama: '',
  ttd_pm_nama: '',
  ttd_finance_nama: '',
  ttd_direktur_nama: '',

  teks: {
    kewajiban_harian: [
      'Melaksanakan pekerjaan sesuai instruksi Project Leader.',
      'Hadir tepat waktu dan melakukan absensi (foto masuk & pulang) di lokasi proyek sebagai dasar perhitungan upah.',
      'Menjaga kebersihan dan keselamatan di area kerja selama pelaksanaan proyek.',
      'Melaporkan setiap kendala atau permasalahan kepada Project Leader sesegera mungkin.',
    ],
    tata_tertib_harian: [
      'Dilarang membawa senjata tajam (selain alat kerja yang sah) atau senjata api.',
      'Dilarang membawa, mengedarkan, atau mengonsumsi minuman keras, narkoba, atau obat-obatan terlarang di dalam site proyek.',
      'Dilarang merokok di sembarang tempat, terutama di dekat penyimpanan bahan mudah terbakar (bahan kimia, thinner, genset). Merokok hanya diizinkan di smoking area yang disediakan.',
      'Setiap orang yang memasuki area proyek wajib mengenakan Alat Pelindung Diri (APD) Standar.',
    ],
    pasal_I:
      'Pihak PERTAMA dan pihak KEDUA sepakat untuk mengadakan ikatan perjanjian kerja sama dimana pihak KEDUA bekerja sebagai {jabatan} (Pemborong) di perusahaan (PT. Eltama Prima Indo) yang berkedudukan di ({alamat}) dan dengan ini pihak KEDUA menyatakan kesediaannya untuk melakukan {pekerjaan}.',
    pasal_I_harian:
      'Pihak PERTAMA dan pihak KEDUA sepakat untuk mengadakan ikatan perjanjian kerja sama dimana pihak KEDUA bekerja sebagai {jabatan} (Tenaga Kerja Harian) di perusahaan (PT. Eltama Prima Indo) yang berkedudukan di ({alamat}) dan dengan ini pihak KEDUA menyatakan kesediaannya untuk melakukan {pekerjaan}.',
    syarat_bayar_harian: [
      'Pembayaran dilakukan {siklus_bayar}.',
      'Upah dihitung dari jumlah hari hadir yang tercatat pada absensi (foto masuk & pulang) di lokasi proyek.',
      'Uang makan dan uang standby dibayarkan sesuai rincian di atas, bila tercantum, untuk hari hadir dan hari standby yang diperintahkan Project Leader.',
      'Hal-hal di luar syarat dan kondisi akan dimusyawarahkan bersama.',
    ],
    pasal_II: [
      'Pihak Kedua bersedia mematuhi dan mentaati seluruh peraturan tata tertib perusahaan yang telah ditetapkan pihak Pertama dan tata tertib saat berada dilokasi tempat kerja proyek.',
      'Apabila pihak Kedua melakukan pekerjaan yang tidak sesuai butir 1 di atas dan perbuatan yang merugikan pihak Pertama, maka pihak Pertama berhak mengevaluasi/ memberikan surat peringatan/SP kepada pihak Kedua, bahkan bisa melakukan pemutusan hubungan kerja antara kedua belah pihak.',
      'Jika ada kerugian yang dikarenakan oleh pihak Kedua maka pihak Kedua harus memberi ganti rugi sebesar harga yang ditimbulkan.',
    ],
    syarat_bayar_borongan: [
      'Luas akan dihitung ulang setelah pekerjaan selesai.',
      'Kasbon untuk transport akan diberikan saat proyek akan dimulai (H-1).',
      'DP borongan akan diberikan saat manpower tiba di site.',
      'Termin pembayaran diberikan setelah ada pengajuan dan disetujui kedua belah pihak.',
      'Pelunasan pembayaran setelah BAP 100% ditandatangani oleh pemberi kerja.',
      'Jaminan Pemeliharaan / retensi sebesar {retensi_pct}% dari nilai kontrak dibayarkan {retensi_hari} hari setelah BAP ditandatangani pemberi kerja.',
      'Jika pihak Kedua mengundurkan diri tanpa persetujuan pihak Pertama maka pihak Kedua harus memberi ganti rugi biaya transportasi, Rapid Test dan biaya-biaya lainnya yang diperlukan untuk mencari manpower pengganti.',
      'Peralatan kerja dan material cat disediakan PT. EPI.',
      'Makan dan Transport manpower ditanggung oleh Pihak Pemborong.',
      'Kontrakan {kontrakan_skema}.',
      'Hal-hal yang berkaitan dengan kualitas pekerjaan, keselamatan/ safety dan keamanan menjadi tanggung jawab Sub kontraktor.',
      'Hal-hal di luar syarat dan kondisi akan dimusyawarahkan bersama.',
    ],
    // Bagian pasal IV setelah butir durasi & jumlah manpower (dua butir itu dinamis).
    pasal_IV: [
      'Kontrak akan berakhir dengan sendirinya atau tidak terikat tanggal tertentu apabila pekerjaan di site telah selesai lebih dahulu daripada masa kontrak, atau dinyatakan selesai dan tutup oleh klien.',
      'PIHAK KEDUA yang ditempatkan di lokasi proyek bersedia mengikuti waktu kerja pokok proyek dengan ketentuan sebagai berikut: {jam_kerja}',
      'PIHAK KEDUA bersedia untuk bekerja lebih dari hari kerja/jam kerja yang telah ditentukan pada {ref_jam} tersebut di atas, bilamana PIHAK PERTAMA memandang perlu berdasarkan perintah PIHAK PERTAMA. Demikian pula halnya PIHAK KEDUA bersedia bekerja pada hari-hari libur atau Hari Raya.',
      'PIHAK KEDUA yang ditempatkan di lokasi proyek bersedia mengikuti jadwal kerja yang ditetapkan oleh PIHAK PERTAMA yang mengacu pada perundang-undangan yang berlaku.',
      'Jadwal kerja PIHAK KEDUA di lokasi proyek akan selalu disesuaikan sesuai permintaan / kesepakatan dengan pemberi kerja.',
      'Perjanjian kerja ini dapat diakhiri atas kesepakatan PARA PIHAK karena adanya force majeure atau keadaan memaksa.',
    ],
    pasal_V: [
      'PIHAK PERTAMA dapat memutuskan hubungan kerja apabila PIHAK KEDUA tidak mampu melaksanakan tugas & pekerjaan yang telah diberikan oleh PIHAK PERTAMA.',
      'PIHAK PERTAMA dapat memutuskan hubungan kerja apabila hasil pemeriksaan Rapid test yang dilakukan, PIHAK KEDUA dinyatakan un-fit (tidak sehat), yang mengakibatkan tidak diperbolehkannya PIHAK KEDUA bekerja dilokasi proyek.',
      'Apabila PIHAK KEDUA setelah dievaluasi PIHAK PERTAMA selama satu bulan dan dinyatakan tidak cakap, maka PIHAK PERTAMA dapat melakukan pemutusan hubungan kerja secara sepihak.',
      'Pemutusan hubungan kerja oleh PIHAK PERTAMA dapat dilakukan karena adanya performa kinerja PIHAK KEDUA yang tidak baik atau berakhirnya masa kontrak kerja.',
      {
        t: 'PIHAK KEDUA dapat mengakhiri Perjanjian Kerja Waktu Tertentu karena kesalahan yang dilakukan PIHAK PERTAMA sebagai berikut :',
        sub: [
          'PIHAK PERTAMA tidak membayar gaji/kasbon yang telah disetujui kedua belah pihak.',
          'Jika PIHAK PERTAMA tidak memenuhi syarat-syarat atau tidak melakukan kewajiban yang ditetapkan dalam Kesepakatan Kerja.',
          'Apabila dilanjutkan hubungan kerja dapat membahayakan keselamatan jiwa atau kesehatan PIHAK KEDUA sewaktu Perjanjian Kerja diadakan.',
        ],
      },
      {
        t: 'Apabila PIHAK KEDUA memutuskan hubungan kerja dengan PIHAK PERTAMA sebelum berakhirnya masa perjanjian kerja maka PIHAK KEDUA diwajibkan :',
        sub: [
          'Memberitahukan secara tertulis kepada PIHAK PERTAMA, berkaitan dengan hal tersebut selambat-lambatnya 30 hari sebelumnya.',
          'Harus menyelesaikan segala bentuk kewajiban terhadap perusahaan, sampai dengan tanggal mulai pengunduran diri.',
          'Melakukan serah terima jabatan kepada atasan langsung secara tertulis dan atau pejabat yang ditunjuk oleh PIHAK PERTAMA.',
          'Melakukan serah terima seluruh barang inventaris perusahaan kepada atasan langsung dan atau pihak yang ditunjuk oleh PIHAK PERTAMA.',
        ],
      },
      'Apabila PIHAK KEDUA mengajukan pengunduran diri tidak memenuhi syarat-syarat sebagaimana termasuk dalam ayat 6 huruf a, b, c, d maka PIHAK PERTAMA tidak akan menyelesaikan dan atau memberikan segala hak PIHAK KEDUA, sampai dengan PIHAK KEDUA memenuhi segala persyaratan sebagaimana tercantum dalam ayat 6 huruf a, b, c, d di atas.',
    ],
    pasal_VI:
      'Apabila di kemudian hari antara pihak PERTAMA dan KEDUA terjadi sengketa/beda sudut pandang, maka akan diselesaikan secara musyawarah dan kekeluargaan, tetapi jika tidak bisa diselesaikan, maka kedua belah pihak bisa menempuh jalur hukum sesuai perundangan yang berlaku.',
    pernyataan_tanpa_harga:
      'Dengan menandatangani dokumen ini, penerima menyatakan telah membaca, memahami, dan bersedia mematuhi seluruh ketentuan di atas. Rincian nilai/upah tercantum pada Surat Perintah Kerja / Surat Tugas lengkap.',
    tata_tertib_berkas: ['KTP', 'Daftar Riwayat Hidup (CV)', 'SKCK (jika diminta)', 'Surat sehat (jika diminta)', 'Sertifikat (jika diminta)'],
    tata_tertib_subcont: [
      'Manpower harus mengikuti aturan dan tata tertib dari pemberi kerja dilapangan (owner/kontraktor pemberi kerja).',
      'Manpower harus mempunyai kendaraan operasional sendiri (mobil atau motor).',
      {
        t: 'Manpower harus mematuhi aturan dan tata tertib dari PT Eltama Prima Indo, sebagai berikut :',
        sub: [
          'Mengisi absen harian',
          'Mengisi form daily proyek',
          'Merawat dan menjaga material cat dan alat kerja',
          'Mengembalikan peralatan kerja dalam kondisi baik dan bersih sesuai surat jalan',
          'Mengembalikan APD yang dipakai jika APD dari PT. Eltama Prima Indo',
          'Mengurus Berita Acara Pekerjaan (BAP) sampai selesai',
        ],
      },
      {
        t: 'Manpower wajib menggunakan APD di area kerja, sebagai berikut :',
        sub: ['Sepatu safety/ sepatu kerja', 'Helm safety', 'Kacamata', 'Kaos seragam', 'Sarung tangan', 'Rompi'],
      },
      {
        t: 'Manpower bertanggung jawab jika :',
        sub: [
          'Barang-barang milik pemberi kerja (owner) rusak/hilang dikarenakan kelalaian manpower',
          'Barang-barang milik PT Eltama Prima Indo rusak/hilang dikarenakan kelalaian manpower',
          'Melakukan perbaikan pekerjaan jika ada complain hasil pekerjaan dilapangan selama masa garansi',
        ],
      },
      'Manpower tidak boleh menawarkan jasa atau produk cat lain ke pihak pemberi kerja (owner) / kontraktor di lingkungan proyek.',
      'Manpower tidak boleh membicarakan harga ke pihak pemberi kerja (owner) / kontraktor.',
      'Manpower wajib ikut serta menyiapkan material cat dan alat-alat kerja yang akan digunakan.',
      'Manpower harus memastikan bahwa material cat, bahan dan alat-alat kerja yang akan dipakai sesuai dengan perhitungan awal.',
      'Setiap manpower dilarang menggunakan material, bahan atau alat-alat proyek untuk kepentingan pribadi maupun lainnya, selain kepentingan PT Eltama Prima Indo.',
      'PT Eltama Prima Indo tidak bertanggung jawab jika terjadi kecelakaan kerja di lapangan.',
      'Biaya sosial yang timbul dilapangan seperti keamanan, preman, karangtaruna dll, bukan menjadi tanggung jawab PT Eltama Prima Indo.',
      'Manpower dilarang keras memberi informasi project kepada pihak lain. Jika manpower memberikan penawaran harga atau masuk langsung ke pihak kontraktor/ owner tanpa melewati PT. Eltama Prima Indo, maka akan diproses secara hukum.',
    ],
  },
};

/* ───────────────────────── Setelan: SATU sumber dengan manpowerSettings (manpower.spk_doc.*) ───────────────────────── */
// Kunci tersimpan di system_settings / app_settings(module=manpower) dengan awalan `manpower.spk_doc.`
// dan dibaca lewat loadManpowerSettings() — BUKAN loader baru (hindari lapisan setelan ketiga).

export const SPK_DOC_NS = 'manpower.spk_doc.';
const NUM_KEYS = ['retensi_pct', 'retensi_hari', 'pph21_pct', 'link_ttl_hari', 'reminder_h_min', 'reminder_maks', 'reminder_interval_jam', 'gate_horizon_hari'];
const BOOL_KEYS = ['ttd_link_aktif', 'otp_wajib', 'reminder_aktif', 'borongan_items_aktif', 'harian_dengan_pasal'];
const STR_KEYS = [
  'jam_kerja', 'harian_siklus_bayar', 'kontrakan_skema', 'kota_surat', 'alamat_perusahaan', 'wa_template', 'reminder_template', 'gate_jenis', 'gate_berlaku_sejak', 'gate_kategori_proyek',
  'ttd_admin_nama', 'ttd_pm_nama', 'ttd_finance_nama', 'ttd_direktur_nama',
];
// kunci setelan (tanpa awalan) → kunci di SPK_DEFAULTS.teks; nilai harus daftar
const LIST_TEKS_KEYS = { tata_tertib_harian: 'tata_tertib_harian', tata_tertib_subcont: 'tata_tertib_subcont' };
// 'klausul' = objek penimpa per blok teks (pasal_I … pasal_VI, kewajiban_harian, dst.)
const OBJ_KEY = 'klausul';

/** Default datar untuk didaftarkan ke MANPOWER_SETTINGS_DEFAULTS (satu sumber nilai: SPK_DEFAULTS). */
export function spkDocDefaultsFlat() {
  const out = {};
  for (const k of [...NUM_KEYS, ...BOOL_KEYS, ...STR_KEYS]) out[SPK_DOC_NS + k] = SPK_DEFAULTS[k];
  for (const k of Object.keys(LIST_TEKS_KEYS)) out[SPK_DOC_NS + k] = null; // null = pakai teks bawaan PDF
  out[SPK_DOC_NS + OBJ_KEY] = null;
  return out;
}

function parseJsonSafe(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch { return null; }
}

/**
 * Gabungkan default dengan peta setelan datar (hasil getAllManpowerSettings()).
 * Nilai rusak/tidak valid DIABAIKAN (pakai default) dan dicatat ke `peringatan`
 * agar tidak ditelan diam-diam. Tidak pernah mengubah SPK_DEFAULTS.
 * @param {Record<string, any>} [map]
 * @returns {{ settings: typeof SPK_DEFAULTS, peringatan: string[] }}
 */
export function mergeSpkSettings(map = {}) {
  const settings = { ...SPK_DEFAULTS, teks: { ...SPK_DEFAULTS.teks } };
  const peringatan = [];
  const src = map || {};
  const val = (k) => src[SPK_DOC_NS + k];

  for (const key of NUM_KEYS) {
    const raw = val(key);
    if (raw === null || raw === undefined || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) settings[key] = n;
    else peringatan.push(`${SPK_DOC_NS}${key}: angka tidak valid (${raw}) — pakai default`);
  }
  for (const key of BOOL_KEYS) {
    const raw = val(key);
    if (raw === null || raw === undefined || raw === '') continue;
    if (raw === true || raw === 'true' || raw === 1 || raw === '1') settings[key] = true;
    else if (raw === false || raw === 'false' || raw === 0 || raw === '0') settings[key] = false;
    else peringatan.push(`${SPK_DOC_NS}${key}: harus true/false (${raw}) — pakai default`);
  }
  for (const key of STR_KEYS) {
    const raw = val(key);
    if (raw === null || raw === undefined) continue;
    // string kosong sah untuk nama penandatangan (= garis TTD kosong); selain itu kosong = default
    // kosong sah untuk nama penandatangan (garis TTD kosong) dan gate_kategori_proyek (kosong = jalur proyek nonaktif)
    if (raw === '' && !key.startsWith('ttd_') && key !== 'gate_kategori_proyek') continue;
    settings[key] = String(raw);
  }
  for (const [key, teksKey] of Object.entries(LIST_TEKS_KEYS)) {
    const raw = val(key);
    if (raw === null || raw === undefined || raw === '') continue;
    const arr = parseJsonSafe(raw);
    if (Array.isArray(arr) && arr.length) settings.teks[teksKey] = arr;
    else peringatan.push(`${SPK_DOC_NS}${key}: harus daftar tidak kosong — pakai default`);
  }
  const rawObj = val(OBJ_KEY);
  if (rawObj !== null && rawObj !== undefined && rawObj !== '') {
    const obj = parseJsonSafe(rawObj);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj)) {
        if (k in SPK_DEFAULTS.teks && v != null && v !== '') settings.teks[k] = v;
        else peringatan.push(`${SPK_DOC_NS}${OBJ_KEY}: kunci "${k}" tidak dikenal — diabaikan`);
      }
    } else peringatan.push(`${SPK_DOC_NS}${OBJ_KEY}: harus objek JSON — pakai default`);
  }
  return { settings, peringatan };
}

/* ───────────────────────── Kode versi klausul ───────────────────────── */

function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

/**
 * Kode versi 8 hex (FNV-1a 32-bit) dari SEMUA isi yang memengaruhi makna hukum dokumen: teks klausul +
 * angka/teks kebijakan (retensi, PPh, jam kerja, siklus bayar, kontrakan). Nama penandatangan, kota, dan alamat
 * tidak ikut. Tercetak di kaki dokumen ("Versi klausul") sebagai rujukan audit — BUKAN pengganti hash
 * kriptografis yang disimpan server saat TTD (Fase 4).
 * @param {typeof SPK_DEFAULTS} [settings]
 */
export function kodeVersiKlausul(settings) {
  const S = settings || SPK_DEFAULTS;
  const basis = stableStringify({
    teks: S.teks || SPK_DEFAULTS.teks,
    retensi_pct: S.retensi_pct, retensi_hari: S.retensi_hari, pph21_pct: S.pph21_pct,
    jam_kerja: S.jam_kerja, harian_siklus_bayar: S.harian_siklus_bayar, kontrakan_skema: S.kontrakan_skema,
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/* ───────────────────────── Util format ───────────────────────── */

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const idNum = (n) => new Intl.NumberFormat('id-ID').format(Math.round(Number(n) || 0));
export const rupiah = (n) => `Rp ${idNum(n)}`;

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/** Tanggal lokal tanpa geser zona waktu untuk string 'YYYY-MM-DD'. */
function toDate(v) {
  if (!v) return null;
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function fmtTanggal(v) {
  const d = toDate(v);
  return d ? `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}` : '-';
}
export function fmtTanggalHari(v) {
  const d = toDate(v);
  return d ? `${HARI[d.getDay()]}, ${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}` : '-';
}

/** Isi {placeholder}; placeholder tak dikenal dibiarkan apa adanya. */
export function isi(template, vars = {}) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

/* ───────────────────────── Hitungan borongan ───────────────────────── */

/**
 * Hitung tabel borongan. `items` = [{ deskripsi, qty, satuan, harga_satuan }].
 * Tanpa items → 1 baris paket dari `nilaiBorongan`.
 * PPh 21 dibulatkan ke rupiah terdekat. pph21Pct 0 → baris PPh disembunyikan.
 */
export function hitungBorongan({ items, nilaiBorongan, jenisPekerjaan, pph21Pct }) {
  let rows = Array.isArray(items)
    ? items
        .map((i) => ({
          deskripsi: String(i?.deskripsi ?? i?.nama ?? '').trim(),
          qty: Number(i?.qty) || 0,
          satuan: String(i?.satuan ?? '').trim(),
          harga: Number(i?.harga_satuan ?? i?.harga) || 0,
        }))
        .filter((i) => i.deskripsi && i.qty > 0)
    : [];
  if (!rows.length) {
    const nilai = Number(nilaiBorongan) || 0;
    rows = nilai > 0
      ? [{ deskripsi: jenisPekerjaan && jenisPekerjaan !== '-' ? String(jenisPekerjaan) : 'Pekerjaan borongan', qty: 1, satuan: 'paket', harga: nilai }]
      : [];
  }
  rows = rows.map((r) => ({ ...r, jumlah: Math.round(r.qty * r.harga) }));
  const total = rows.reduce((s, r) => s + r.jumlah, 0);
  const pct = Number(pph21Pct) || 0;
  const pph21 = Math.round((total * pct) / 100);
  return { rows, total, pph21Pct: pct, pph21, netto: total - pph21 };
}

/* ───────────────────────── Bangun HTML ───────────────────────── */

function listHtml(items, vars = {}) {
  const li = (it) => {
    if (it && typeof it === 'object') {
      const sub = (it.sub || []).map((s) => `<li>${esc(isi(s, vars))}</li>`).join('');
      return `<li>${esc(isi(it.t, vars))}${sub ? `<ol type="a" class="sub">${sub}</ol>` : ''}</li>`;
    }
    return `<li>${esc(isi(it, vars))}</li>`;
  };
  return `<ol>${(items || []).map(li).join('')}</ol>`;
}

function sigBlock({ label = '', role, nama = '', img = '', city = '' }) {
  return `<div class="sig-cell">
    <div class="sig-label">${esc(label)}</div>
    ${city ? `<div class="sig-city">${esc(city)}</div>` : ''}
    <div class="sig-space">${img || ''}</div>
    <div class="sig-line">${nama ? esc(nama) : '&nbsp;'}</div>
    <div class="sig-role">${esc(role)}</div>
  </div>`;
}

function identitasRow(label, value) {
  return value ? `<tr><td>${esc(label)}</td><td class="colon">:</td><td>${value}</td></tr>` : '';
}

function pasalBlock(judul, inner) {
  return `<div class="pasal"><div class="pasal-title">${esc(judul)}</div>${inner}</div>`;
}

function hitungDurasiHari(mulai, selesai) {
  const a = toDate(mulai);
  const b = toDate(selesai);
  if (!a || !b || b < a) return null;
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * Hapus SEMUA field bernilai uang dari assignment (default-deny: awalan rate_/nilai_/upah/harga/total/borongan_*,
 * kecuali borongan_items yang dibersihkan jadi {deskripsi, qty, satuan}). Dipakai builder mode tanpa harga
 * dan WAJIB dipakai API publik tautan sebelum payload dikirim ke browser (Fase 4).
 * @param {object} a
 */
export function stripHargaAssignment(a) {
  const out = {};
  for (const [k, v] of Object.entries(a || {})) {
    if (/^(rate_|nilai_|upah|harga|total|biaya|borongan_(?!items$))/i.test(k)) continue;
    out[k] = v;
  }
  if (Array.isArray(a?.borongan_items)) {
    out.borongan_items = a.borongan_items.map((i) => ({
      deskripsi: i?.deskripsi ?? i?.nama ?? '',
      qty: i?.qty,
      satuan: i?.satuan ?? '',
    }));
  }
  // catatan bebas-teks bisa memuat nominal → tidak ikut (default-deny)
  delete out.catatan;
  return out;
}

const WATERMARK_TANPA_HARGA = 'SYARAT & KETENTUAN — TANPA RINCIAN NILAI';

/**
 * @param {object} ctx
 * @param {boolean} [ctx.tanpaHarga]  true = versi Syarat Manpower tanpa nominal (watermark + semua nilai dihapus)
 * @param {object} ctx.a            baris manpower_assignment
 * @param {object} [ctx.mp]         baris manpower (nama, NIK, no_telpon, posisi)
 * @param {object} [ctx.pr]         proyek (name, nomor_po, lokasi, jenis_project, child_projects, tanggal_po)
 * @param {object} [ctx.settings]   hasil mergeSpkSettings().settings (default bila kosong)
 * @param {string} [ctx.ttdImg]     <img> TTD penerima (data URI) bila sudah ditandatangani
 * @returns {{ varian:'harian'|'borongan', html:string, hitung:object|null, namaManpower:string, namaProject:string, nomorSPK:string }}
 */
export function buildSpkDocument(ctx) {
  const tanpaHarga = ctx?.tanpaHarga === true;
  const a = tanpaHarga ? stripHargaAssignment(ctx?.a || {}) : (ctx?.a || {});
  const mp = ctx?.mp || {};
  const pr = ctx?.pr || {};
  const S = ctx?.settings || SPK_DEFAULTS;
  const T = S.teks || SPK_DEFAULTS.teks;
  const varian = (ctx?.a?.rate_tipe ?? a.rate_tipe) === 'borongan' ? 'borongan' : 'harian';

  const namaManpower = mp.nama || a.ttd_nama || '-';
  const posisi = a.jabatan || mp.posisi || 'Tenaga Kerja';
  const nik = mp.NIK || '';
  const tlp = mp.no_telpon || '';
  const namaProject = pr.name || '-';
  const nomorPO = pr.nomor_po || '';
  const lokasi = a.lokasi || pr.lokasi || '-';
  const jenisPekerjaan = a.jenis_pekerjaan || pr.jenis_project || '-';
  const nomorSPK = a.nomor_spk || '-';
  const keterangan = a.catatan || '';
  const tglSurat = a.tanggal_spk || new Date();
  const kota = `${S.kota_surat}, ${fmtTanggal(tglSurat)}`;
  const childPO = Array.isArray(pr.child_projects) && pr.child_projects.length
    ? pr.child_projects.map((cp) => cp.nomor_po || cp.name).filter(Boolean).join(', ')
    : '';
  const ttdImg = ctx?.ttdImg || '';

  const periodeMulai = a.tanggal_mulai ? fmtTanggal(a.tanggal_mulai) : '-';
  const periodeSelesai = a.tanggal_selesai ? fmtTanggal(a.tanggal_selesai) : 'Proyek selesai';

  const vars = {
    retensi_pct: S.retensi_pct,
    retensi_hari: S.retensi_hari,
    kontrakan_skema: S.kontrakan_skema,
    jam_kerja: S.jam_kerja,
    siklus_bayar: S.harian_siklus_bayar,
    jabatan: posisi,
    alamat: S.alamat_perusahaan,
  };

  const kodeVersi = kodeVersiKlausul(S);
  const banner = tanpaHarga
    ? `<div class="wm-tanpa-harga" aria-hidden="true">${esc(WATERMARK_TANPA_HARGA)}</div>
       <div class="banner-tanpa-harga"><strong>${esc(WATERMARK_TANPA_HARGA)}</strong><br>Dokumen ini bukan surat perintah kerja yang sah. Nilai/upah tercantum pada dokumen lengkap.</div>`
    : '';
  const pernyataan = tanpaHarga ? `<p style="margin-top:10px;">${esc(T.pernyataan_tanpa_harga || SPK_DEFAULTS.teks.pernyataan_tanpa_harga)}</p>` : '';

  /* ───────── Harian ───────── */
  if (varian === 'harian' && S.harian_dengan_pasal !== false) {
    const kewajiban = [...(T.kewajiban_harian || []), ...(keterangan ? [keterangan] : [])];
    const jenisTugas = `Pekerjaan ${jenisPekerjaan} untuk ${namaProject}${nomorPO ? ` PO ${nomorPO}` : ''}`;
    const rincianUpah = tanpaHarga ? '' : `<div class="assigns-to"><table>
        ${identitasRow('Upah Harian', Number(a.rate_harian) > 0 ? `<strong>${rupiah(a.rate_harian)}</strong>` : '')}
        ${identitasRow('Uang Makan', Number(a.rate_uang_makan) > 0 ? rupiah(a.rate_uang_makan) : '')}
        ${identitasRow('Uang Standby', Number(a.rate_standby) > 0 ? rupiah(a.rate_standby) : '')}
      </table></div>`;
    const bayar = Array.isArray(T.syarat_bayar_harian) ? T.syarat_bayar_harian : SPK_DEFAULTS.teks.syarat_bayar_harian;
    const pasal4Raw = [
      `Periode kerja: ${periodeMulai} s/d ${periodeSelesai}.`,
      ...(Array.isArray(T.pasal_IV) ? T.pasal_IV : []),
    ];
    const idxJam = pasal4Raw.findIndex((t) => String(t).includes('{jam_kerja}'));
    const pasal4 = pasal4Raw.map((t) => isi(t, { ...vars, ref_jam: idxJam >= 0 ? `Pasal IV ayat (${idxJam + 1})` : 'ketentuan jam kerja' }));
    const ttHarian = [`Pembayaran dilakukan ${S.harian_siklus_bayar}.`, ...(T.tata_tertib_harian || [])];
    const html = `
      ${banner}
      <div class="doc-title"><h2>Surat Perintah Kerja</h2></div>
      <div class="doc-number">Nomor : ${esc(nomorSPK)}</div>
      <div class="preamble"><p>Yang bertandatangan dibawah ini:</p></div>
      <div class="assigns-to"><table>
        ${identitasRow('Nama', `<strong>${esc(S.ttd_pm_nama || '........................')}</strong>`)}
        ${identitasRow('Jabatan', 'Project Manager')}
      </table></div>
      <div class="preamble"><p>Mewakili PT. Eltama Prima Indo, selanjutnya disebut sebagai <strong>PIHAK PERTAMA</strong>,</p></div>
      <div class="assigns-to"><table>
        ${identitasRow('Nama', `<strong>${esc(namaManpower)}</strong>`)}
        ${identitasRow('Jabatan / Posisi', esc(posisi))}
        ${identitasRow('NIK', esc(nik))}
        ${identitasRow('Tlp', esc(tlp))}
      </table></div>
      <div class="preamble"><p>Mewakili pribadi, selanjutnya disebut sebagai <strong>PIHAK KEDUA</strong>.</p></div>

      ${pasalBlock('PASAL I (BENTUK KERJASAMA)', `<p>${esc(isi(T.pasal_I_harian || SPK_DEFAULTS.teks.pasal_I_harian, { ...vars, jabatan: posisi, pekerjaan: jenisTugas }))}</p>${
        (lokasi && lokasi !== '-') ? `<p class="muted">Lokasi pekerjaan: ${esc(lokasi)}.</p>` : ''}${childPO ? `<p class="muted">Paket PO: ${esc(childPO)}.</p>` : ''}`)}
      ${pasalBlock('PASAL II (TATA TERTIB PERUSAHAAN)', listHtml(T.pasal_II, vars))}
      ${pasalBlock(tanpaHarga ? 'PASAL III (SYARAT PEMBAYARAN)' : 'PASAL III (UPAH & PEMBAYARAN)', `${rincianUpah}
        <p class="sec-head">Syarat dan kondisi Pembayaran :</p>
        ${listHtml(bayar, vars)}`)}
      ${pasalBlock('PASAL IV (MASA PERJANJIAN KERJA)', listHtml(pasal4))}
      ${pasalBlock('PASAL V (PEMUTUSAN HUBUNGAN KERJA)', listHtml(T.pasal_V, vars))}
      ${pasalBlock('PASAL VI (SENGKETA / MASALAH)', `<p>${esc(isi(T.pasal_VI, vars))}</p>`)}

      <div class="page-break"></div>
      <div class="doc-title"><h2>Ketentuan Kerja &amp; Tata Tertib</h2></div>
      <div class="note-section">
        <p>Yang bersangkutan wajib memenuhi ketentuan sebagai berikut:</p>
        ${listHtml(kewajiban)}
        <p class="sec-head">Syarat Pembayaran dan Tata Tertib :</p>
        ${listHtml(ttHarian)}
        <p style="margin-top:10px;">Demikian Surat Perintah Kerja ini dibuat untuk dapat dilaksanakan dengan penuh tanggung jawab.</p>
        ${pernyataan}
      </div>
      <div class="sig-city-line">${esc(kota)}</div>
      <div class="sig-grid sig-4">
        ${sigBlock({ label: 'Dibuat oleh,', role: 'Project Admin', nama: S.ttd_admin_nama })}
        ${sigBlock({ label: 'Disetujui,', role: 'Project Manager', nama: S.ttd_pm_nama })}
        ${sigBlock({ label: 'Penerima tugas,', role: posisi, nama: namaManpower, img: ttdImg })}
        ${sigBlock({ label: 'Mengetahui,', role: 'Direktur', nama: S.ttd_direktur_nama })}
      </div>
      <div class="ref-versi">Versi klausul: ${kodeVersi}</div>`;
    return { varian, tanpaHarga, html, hitung: null, namaManpower, namaProject, nomorSPK, kodeVersi };
  }

  if (varian === 'harian') {
    const tt = [`Pembayaran dilakukan ${S.harian_siklus_bayar}.`, ...(T.tata_tertib_harian || [])];
    const kewajiban = [...(T.kewajiban_harian || []), ...(keterangan ? [keterangan] : [])];
    const html = `
      ${banner}
      <div class="doc-title"><h2>Surat Perintah Kerja</h2></div>
      <div class="doc-number">No. ${esc(nomorSPK)}</div>
      <div class="preamble"><p>Yang bertanda tangan di bawah ini, Pimpinan PT. Eltama Prima Indo, dengan ini memberikan perintah kerja kepada:</p></div>
      <div class="assigns-to"><table>
        ${identitasRow('Nama', `<strong>${esc(namaManpower)}</strong>`)}
        ${identitasRow('Jabatan / Posisi', esc(posisi))}
        ${identitasRow('NIK', esc(nik))}
        ${identitasRow('No. Telepon', esc(tlp))}
      </table></div>
      <div class="preamble"><p>Untuk melaksanakan pekerjaan pada proyek dengan rincian sebagai berikut:</p></div>
      <div class="task-box"><table style="width:100%;border-collapse:collapse;">
        ${identitasRow('Nama Project', `<strong>${esc(namaProject)}</strong>`)}
        ${identitasRow('Nomor PO', nomorPO ? `${esc(nomorPO)}${childPO ? ` <span class="muted">(Konsolidasi Paket ${pr.child_projects.length} PO)</span>` : ''}` : '')}
        ${identitasRow('Daftar PO Paket', esc(childPO))}
        ${identitasRow('Lokasi Pekerjaan', esc(lokasi))}
        ${identitasRow('Jenis Pekerjaan', esc(jenisPekerjaan))}
        ${identitasRow('Periode Kerja', `${esc(periodeMulai)} &nbsp;s/d&nbsp; ${esc(periodeSelesai)}`)}
        ${tanpaHarga ? '' : identitasRow('Upah Harian', Number(a.rate_harian) > 0 ? `<strong>${rupiah(a.rate_harian)}</strong>` : '')}
        ${tanpaHarga ? '' : identitasRow('Uang Makan', Number(a.rate_uang_makan) > 0 ? rupiah(a.rate_uang_makan) : '')}
        ${tanpaHarga ? '' : identitasRow('Uang Standby', Number(a.rate_standby) > 0 ? rupiah(a.rate_standby) : '')}
      </table></div>
      <div class="note-section">
        <p>Yang bersangkutan wajib memenuhi ketentuan sebagai berikut:</p>
        ${listHtml(kewajiban)}
        <p class="sec-head">Syarat Pembayaran dan Tata Tertib :</p>
        ${listHtml(tt)}
        <p style="margin-top:10px;">Demikian Surat Perintah Kerja ini dibuat untuk dapat dilaksanakan dengan penuh tanggung jawab.</p>
        ${pernyataan}
      </div>
      <div class="sig-city-line">${esc(kota)}</div>
      <div class="sig-grid sig-4">
        ${sigBlock({ label: 'Dibuat oleh,', role: 'Project Admin', nama: S.ttd_admin_nama })}
        ${sigBlock({ label: 'Disetujui,', role: 'Project Manager', nama: S.ttd_pm_nama })}
        ${sigBlock({ label: 'Penerima tugas,', role: posisi, nama: namaManpower, img: ttdImg })}
        ${sigBlock({ label: 'Mengetahui,', role: 'Direktur', nama: S.ttd_direktur_nama })}
      </div>
      <div class="ref-versi">Versi klausul: ${kodeVersi}</div>`;
    return { varian, tanpaHarga, html, hitung: null, namaManpower, namaProject, nomorSPK, kodeVersi };
  }

  /* ───────── Borongan ───────── */
  const hitung = hitungBorongan({
    items: a.borongan_items,
    nilaiBorongan: a.nilai_borongan,
    jenisPekerjaan,
    pph21Pct: S.pph21_pct,
  });

  const pekerjaanTeks = `Pekerjaan ${jenisPekerjaan} untuk ${namaProject}${nomorPO ? ` PO ${nomorPO}` : ''}${pr.tanggal_po ? ` tanggal ${fmtTanggal(pr.tanggal_po)}` : ''}`;
  const jabatanPemborong = /pemborong/i.test(posisi) ? posisi : `${posisi} (Pemborong)`;

  const lingkupRows = (Array.isArray(a.borongan_items) ? a.borongan_items : [])
    .map((i) => ({ deskripsi: String(i?.deskripsi ?? '').trim(), qty: Number(i?.qty) || 0, satuan: String(i?.satuan ?? '').trim() }))
    .filter((i) => i.deskripsi && i.qty > 0);
  const tabelLingkup = `<table class="pricing-table">
      <thead><tr><th style="width:7%">No</th><th>Lingkup Pekerjaan</th><th style="width:14%">Qty</th><th style="width:16%">Satuan</th></tr></thead>
      <tbody>${(lingkupRows.length ? lingkupRows : [{ deskripsi: jenisPekerjaan && jenisPekerjaan !== '-' ? String(jenisPekerjaan) : 'Pekerjaan borongan', qty: 0, satuan: '' }])
        .map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.deskripsi)}</td><td class="num">${r.qty ? idNum(r.qty) : '-'}</td><td class="num">${esc(r.satuan || '-')}</td></tr>`).join('')}
      </tbody></table>`;

  const tabelGaji = hitung.rows.length
    ? `<table class="pricing-table">
        <thead><tr>
          <th style="width:6%">No</th><th>Deskripsi</th><th style="width:9%">Qty</th>
          <th style="width:10%">Satuan</th><th style="width:17%">Harga Satuan</th><th style="width:19%">Jumlah (Rp)</th>
        </tr></thead>
        <tbody>
          ${hitung.rows.map((r, i) => `<tr>
            <td class="num">${i + 1}</td><td>${esc(r.deskripsi)}</td>
            <td class="num">${idNum(r.qty)}</td><td class="num">${esc(r.satuan || '-')}</td>
            <td class="right">${idNum(r.harga)}</td><td class="right">${idNum(r.jumlah)}</td></tr>`).join('')}
          <tr class="summary"><td colspan="5" class="right">TOTAL</td><td class="right">${idNum(hitung.total)}</td></tr>
          ${hitung.pph21Pct > 0 ? `<tr class="summary"><td colspan="5" class="right">PPH 21 (${String(hitung.pph21Pct).replace('.', ',')}%)</td><td class="right">${idNum(hitung.pph21)}</td></tr>
          <tr class="total-final"><td colspan="5" class="right">TOTAL (setelah PPH 21)</td><td class="right">${idNum(hitung.netto)}</td></tr>` : ''}
        </tbody></table>`
    : '<p class="muted">Nilai borongan belum diisi pada penugasan ini.</p>';

  const durasi = hitungDurasiHari(a.tanggal_mulai, a.tanggal_selesai);
  const minManpower = Number(a.jumlah_manpower_min) > 0 ? Number(a.jumlah_manpower_min) : null;
  const pasal4Raw = [
    durasi
      ? `Jangka waktu kontrak pengerjaan ${durasi} hari sejak manpower tiba dilokasi.`
      : 'Jangka waktu kontrak pengerjaan mengikuti jadwal proyek yang ditetapkan PIHAK PERTAMA sejak manpower tiba dilokasi.',
    ...(minManpower ? [`Jumlah manpower minimal ${minManpower} orang.`] : []),
    ...(Array.isArray(T.pasal_IV) ? T.pasal_IV : []),
  ];
  const idxJam = pasal4Raw.findIndex((t) => String(t).includes('{jam_kerja}'));
  const pasal4 = pasal4Raw.map((t) => isi(t, { ...vars, ref_jam: idxJam >= 0 ? `Pasal IV ayat (${idxJam + 1})` : 'ketentuan jam kerja' }));

  const berkas = (T.tata_tertib_berkas || []).map((b, i) => `<li>${esc(b)}</li>`).join('');

  const html = `
    ${banner}
    <div class="doc-title"><h2>Surat Tugas</h2></div>
    <div class="doc-number">Nomor : ${esc(nomorSPK)}</div>
    <div class="preamble"><p>Yang bertandatangan dibawah ini:</p></div>
    <div class="assigns-to"><table>
      ${identitasRow('Nama', `<strong>${esc(S.ttd_pm_nama || '........................')}</strong>`)}
      ${identitasRow('Jabatan', 'Project Manager')}
    </table></div>
    <div class="preamble"><p>Mewakili PT. Eltama Prima Indo, selanjutnya disebut sebagai <strong>PIHAK PERTAMA</strong>,</p></div>
    <div class="assigns-to"><table>
      ${identitasRow('Nama', `<strong>${esc(namaManpower)}</strong>`)}
      ${identitasRow('Jabatan', esc(jabatanPemborong))}
      ${identitasRow('NIK', esc(nik))}
      ${identitasRow('Tlp', esc(tlp))}
    </table></div>
    <div class="preamble"><p>Mewakili pribadi, selanjutnya disebut sebagai <strong>PIHAK KEDUA</strong>.</p></div>

    ${pasalBlock('PASAL I (BENTUK KERJASAMA)', `<p>${esc(isi(T.pasal_I, { ...vars, jabatan: posisi, pekerjaan: pekerjaanTeks }))}</p>${
      (lokasi && lokasi !== '-') ? `<p class="muted">Lokasi pekerjaan: ${esc(lokasi)}.</p>` : ''}`)}
    ${pasalBlock('PASAL II (TATA TERTIB PERUSAHAAN)', listHtml(T.pasal_II, vars))}
    ${pasalBlock(tanpaHarga ? 'PASAL III (RUANG LINGKUP & SYARAT PEMBAYARAN)' : 'PASAL III (NILAI BORONGAN)', `${tanpaHarga ? tabelLingkup : tabelGaji}
      <p class="sec-head">Syarat dan kondisi Pembayaran :</p>
      ${listHtml([...(T.syarat_bayar_borongan || []), ...(keterangan ? [keterangan] : [])], vars)}`)}
    ${pasalBlock('PASAL IV (MASA PERJANJIAN KERJA)', listHtml(pasal4))}
    ${pasalBlock('PASAL V (PEMUTUSAN HUBUNGAN KERJA)', listHtml(T.pasal_V, vars))}
    ${pasalBlock('PASAL VI (SENGKETA / MASALAH)', `<p>${esc(isi(T.pasal_VI, vars))}</p>`)}

    <p style="margin-top:10px;">Demikian surat perjanjian kerja ini dibuat atas kesepakatan dan persetujuan kedua belah pihak, supaya dapat dipergunakan sebagaimana mestinya.</p>
    ${pernyataan}
    <div class="sig-city-line">${esc(kota)}</div>
    <div class="sig-grid sig-3">
      ${sigBlock({ label: 'PT. ELTAMA PRIMA INDO,', role: 'Project Finance', nama: S.ttd_finance_nama })}
      ${sigBlock({ label: '', role: 'Project Manager', nama: S.ttd_pm_nama })}
      ${sigBlock({ label: 'Penerima tugas,', role: jabatanPemborong, nama: namaManpower, img: ttdImg })}
    </div>

    <div class="page-break"></div>
    <div class="doc-title"><h2>Tata Tertib Subcont (Aplikator)</h2></div>
    <div class="note-section">
      <p>Manpower yang akan bekerja harus memberikan data pribadi, sebagai berikut :</p>
      <ol type="a" class="sub">${berkas}</ol>
      ${listHtml(T.tata_tertib_subcont, vars)}
      <p style="margin-top:10px;">Demikian Tata Tertib ini dibuat, untuk dapat dijalankan dan dipatuhi sebagaimana mestinya.</p>
    </div>
    <div class="sig-grid sig-2">
      ${sigBlock({ label: 'Pemberi Kerja, PT. Eltama Prima Indo', role: 'Project Finance', nama: S.ttd_finance_nama })}
      ${sigBlock({ label: 'Penerima Kerja,', role: jabatanPemborong, nama: namaManpower, img: ttdImg })}
    </div>
    <div class="ref-versi">Versi klausul: ${kodeVersi}</div>`;

  return { varian, tanpaHarga, html, hitung: tanpaHarga ? null : hitung, namaManpower, namaProject, nomorSPK, kodeVersi };
}
