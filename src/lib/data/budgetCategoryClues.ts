// src/lib/data/budgetCategoryClues.ts
// Kamus clue, contoh pengeluaran, kata kunci pencarian, dan syarat wajib untuk setiap kategori anggaran.

export interface BudgetCategoryClueItem {
  nama: string;
  icon: string;
  description: string;
  examples: string[];
  requirements: string[];
  keywords: string[];
}

export const BUDGET_CATEGORY_CLUES: Record<string, BudgetCategoryClueItem> = {
  gaji_manpower: {
    nama: 'Upah Manpower',
    icon: '👤',
    description: 'Pembayaran upah pekerja harian lepas, teknisi lapangan, lembur borongan, atau kasbon tenaga kerja.',
    examples: ['Upah tukang harian', 'Gaji teknisi lapangan', 'Lembur borongan', 'Kasbon pekerja', 'Uang makan lembur mekanik'],
    requirements: [
      'Wajib memilih Proyek Terkait (jika pengajuan proyek)',
      'Wajib rincian manpower & absensi 100% terverifikasi HRD (G12-G16)',
      'Wajib transfer ke rekening pekerja / mandor terdaftar'
    ],
    keywords: ['upah', 'gaji', 'manpower', 'pekerja', 'tukang', 'mandor', 'teknisi', 'borongan', 'lembur', 'kasbon', 'ongkos']
  },
  subkon_jasa: {
    nama: 'Subkon / Jasa Pihak Ketiga',
    icon: '🤝',
    description: 'Pembayaran jasa pihak ketiga, vendor perbaikan, jasa kalibrasi, servis berkala, atau subkontraktor pengerjaan khusus.',
    examples: ['Jasa kalibrasi alat', 'Servis AC & mesin', 'Jasa instalasi listrik', 'Ekspedisi & kontainer', 'Jasa pengelasan pihak ke-3'],
    requirements: [
      'Lampirkan penawaran / quotation resmi vendor',
      'Lampirkan Surat Perintah Kerja (SPK) / Invoice vendor',
      'Wajib nota / bukti transfer fisik'
    ],
    keywords: ['jasa', 'subkon', 'service', 'servis', 'kalibrasi', 'reparasi', 'instalasi', 'ekspedisi', 'kontainer', 'las', 'bengkel', 'vendor']
  },
  subkontraktor_termin: {
    nama: 'Subkontraktor (Termin)',
    icon: '🏗️',
    description: 'Pembayaran termin bertahap ke subkontraktor resmi yang terikat kontrak proyek.',
    examples: ['Termin 1 (DP 30%) Proyek Pengecatan', 'Termin 2 Progress 60%', 'Pelunasan Termin BAST 100%'],
    requirements: [
      'Wajib memilih Kontrak Aktif di Contract Registry (G_KONTRAK)',
      'Wajib isi nomor Termin & Progress Diklaim (%)',
      'Wajib ada BAST yang sudah di-approve untuk termin ini (G_BAST)',
      'Wajib memilih Proyek Terkait'
    ],
    keywords: ['termin', 'subkontraktor', 'kontrak', 'bast', 'progres', 'progress', 'tahap', 'spk']
  },
  komisi_internal: {
    nama: 'Komisi Internal',
    icon: '🎯',
    description: 'Komisi atau bonus penjualan untuk tim sales / karyawan internal perusahaan.',
    examples: ['Komisi closing Sales Order Proyek X', 'Bonus pencapaian target sales', 'Fee marketing internal'],
    requirements: [
      'Wajib memilih Sales Order (SO) terkait (G_KOMISI)',
      'SO harus berstatus Completed / Paid dan sudah ber-invoice terbit',
      'Wajib isi persentase komisi & nama penerima'
    ],
    keywords: ['komisi', 'sales', 'internal', 'so', 'sales order', 'bonus', 'closing', 'deal']
  },
  komisi_external: {
    nama: 'Komisi External / Agen',
    icon: '🤝',
    description: 'Komisi, mediator fee, atau imbalan jasa perantara untuk pihak luar/agen.',
    examples: ['Success fee agen pemasaran luar', 'Komisi mediator proyek PT XYZ', 'Fee referal pihak ketiga'],
    requirements: [
      'Wajib memilih Sales Order (SO) terkait (G_KOMISI)',
      'Wajib lampirkan MoU / Perjanjian Kerjasama Agen yang aktif (G_KONTRAK)',
      'Wajib isi persentase komisi & identitas agen'
    ],
    keywords: ['komisi eksternal', 'agen', 'mediator', 'perantara', 'fee', 'referal', 'makelar', 'broker']
  },
  operasional: {
    nama: 'Operasional',
    icon: '💳',
    description: 'Biaya operasional rutin lapangan & kantor (BBM, bahan/material, sewa alat, kas kecil).',
    examples: ['BBM armada / generator', 'Sewa mesin / scaffolding', 'Material habis pakai', 'Petty cash kantor'],
    requirements: [
      'Wajib nota / kuitansi / bukti pembayaran fisik asli (G8)',
      'Wajib Surat Pertanggungjawaban (SPJ) maksimal 14 hari kerja (G17)',
      'Pilih sub-kategori yang spesifik untuk pencatatan pos anggaran yang tepat'
    ],
    keywords: ['operasional', 'lapangan', 'rutin', 'kantor', 'biaya harian', 'kas']
  },
  bbm_transport: {
    nama: 'BBM, Tol & Transport',
    icon: '⛽',
    description: 'Biaya bahan bakar kendaraan/alat, tarif jalan tol, tiket perjalanan dinas, dan transportasi tim.',
    examples: ['BBM Solar mobil operasional', 'Bensin motor patroli/site', 'Top-up e-Toll', 'Tiket pesawat / travel dinas', 'Grab / GoCar meeting klien', 'Parkir & retribusi'],
    requirements: [
      'Wajib struk / struk digital SPBU & e-toll',
      'Lampirkan boarding pass / tiket untuk perjalanan dinas',
      'SPJ dan nota diserahkan maksimal 14 hari'
    ],
    keywords: ['bbm', 'bensin', 'solar', 'pertalite', 'pertamax', 'tol', 'etoll', 'transport', 'tiket', 'pesawat', 'travel', 'grab', 'gocar', 'taksi', 'parkir']
  },
  material_supplier: {
    nama: 'Material & Bahan',
    icon: '📦',
    description: 'Pembelian bahan baku, material habis pakai proyek/workshop, cat, thiner, dan perlengkapan kerja.',
    examples: ['Cat primer & topcoat', 'Thiner & solvent', 'Semen, pasir, besi', 'Kuas, roll cat, amplas', 'Perlengkapan safety / APD (helm, rompi, sarung tangan)'],
    requirements: [
      'Lampirkan nota / faktur pembelian dari toko/supplier',
      'Cantumkan vendor / nama toko',
      'Pastikan jumlah dan satuan unit terisi jelas'
    ],
    keywords: ['material', 'bahan', 'supplier', 'cat', 'thiner', 'semen', 'besi', 'apd', 'safety', 'kuas', 'amplas', 'baut', 'pipa']
  },
  sewa_alat: {
    nama: 'Sewa Alat & Mesin',
    icon: '🚜',
    description: 'Biaya sewa peralatan kerja, mesin kompresor, genset, kendaraan angkut, scaffolding, atau alat ukur.',
    examples: ['Sewa kompresor blasting 375 CFM', 'Sewa genset 50 KVA', 'Sewa pipa scaffolding', 'Sewa mobil pick-up / crane', 'Sewa alat uji blasting'],
    requirements: [
      'Lampirkan nota / kuitansi sewa vendor',
      'Cantumkan durasi sewa (hari/minggu/bulan)',
      'Wajib mencantumkan proyek terkait jika digunakan di site'
    ],
    keywords: ['sewa alat', 'kompresor', 'genset', 'scaffolding', 'steger', 'crane', 'pickup', 'pick up', 'mobil pick up', 'excavator', 'molen', 'alat berat']
  },
  petty_cash: {
    nama: 'Kas Kecil (Petty Cash)',
    icon: '💵',
    description: 'Uang muka kasir operasional atau dana talangan belanja harian mendesak.',
    examples: ['Pengisian saldo petty cash site', 'Kasbon konsumsi rapat mendadak', 'Biaya fotokopi & materai darurat', 'Konsumsi tamu kantor'],
    requirements: [
      'Wajib SPJ maksimal 7 hari kerja (lebih ketat dari operasional biasa)',
      'Wajib melampirkan seluruh kuitansi pengeluaran riil',
      'Maksimal batas nominal saldo petty cash yang disetujui'
    ],
    keywords: ['petty cash', 'kas kecil', 'kasbon', 'uang muka', 'dana kasir', 'talangan', 'konsumsi', 'fotokopi', 'materai']
  },
  hr_ga: {
    nama: 'HR & GA',
    icon: '🏢',
    description: 'Belanja utilitas kantor pusat, fasilitas umum, perlengkapan kerja, dan pengelolaan SDM.',
    examples: ['Tagihan PLN & PDAM', 'Iuran BPJS Karyawan', 'Belanja ATK bulanan', 'Perlengkapan pantry & kebersihan', 'Sewa gedung/ruko'],
    requirements: [
      'Diutamakan untuk Departemen HRD / Umum',
      'Wajib lampirkan tagihan resmi / bukti bayar',
      'Pilih sub-kategori yang sesuai'
    ],
    keywords: ['hr', 'ga', 'hrd', 'umum', 'kantor', 'utilitas', 'gedung', 'bpjs', 'atk']
  },
  hr_ga_listrik: {
    nama: 'Listrik (PLN)',
    icon: '⚡',
    description: 'Pembayaran tagihan listrik PLN bulanan atau token listrik kantor, workshop, dan mess karyawan.',
    examples: ['Tagihan listrik PLN kantor pusat', 'Token listrik workshop Ciketing', 'Listrik mess tim proyek'],
    requirements: ['Wajib bukti struk PLN / ID pelanggan PLN'],
    keywords: ['listrik', 'pln', 'token listrik', 'daya listrik', 'kwh']
  },
  hr_ga_air: {
    nama: 'Air (PDAM)',
    icon: '💧',
    description: 'Pembayaran tagihan air PDAM atau pengadaan air bersih kantor dan workshop.',
    examples: ['Tagihan air PDAM bulanan', 'Pengisian tangki air bersih workshop'],
    requirements: ['Wajib struk pembayaran PDAM / bukti pembelian'],
    keywords: ['air', 'pdam', 'air bersih', 'tangki air', 'tagihan air']
  },
  hr_ga_internet: {
    nama: 'Internet & Komunikasi',
    icon: '🌐',
    description: 'Pembayaran tagihan internet/wifi bulanan kantor atau pulsa/paket data operasional.',
    examples: ['Tagihan IndiHome / Biznet kantor', 'Paket data modem site proyek', 'Tagihan telepon kantor'],
    requirements: ['Wajib bukti bayar / invoice provider internet'],
    keywords: ['internet', 'wifi', 'indihome', 'biznet', 'modem', 'pulsa', 'kuota', 'telepon']
  },
  hr_ga_bpjs_kesehatan: {
    nama: 'BPJS Kesehatan',
    icon: '🏥',
    description: 'Pembayaran iuran bulanan program jaminan kesehatan BPJS untuk seluruh karyawan.',
    examples: ['Iuran BPJS Kesehatan bulanan periode berjalan'],
    requirements: ['Wajib bukti bayar / tagihan e-DABU BPJS Kesehatan'],
    keywords: ['bpjs', 'kesehatan', 'edabu', 'asuransi', 'jaminan kesehatan']
  },
  hr_ga_bpjs_ketenagakerjaan: {
    nama: 'BPJS Ketenagakerjaan',
    icon: '🛡️',
    description: 'Pembayaran iuran jaminan kecelakaan kerja, jaminan kematian, JHT, dan JP karyawan.',
    examples: ['Iuran BPJS Ketenagakerjaan (JKK, JKM, JHT, JP) bulanan'],
    requirements: ['Wajib bukti bayar / tagihan SIPP BPJS TK'],
    keywords: ['bpjs tk', 'ketenagakerjaan', 'jamsostek', 'jht', 'jkk', 'jkm', 'jp', 'sipp']
  },
  hr_ga_atk: {
    nama: 'Alat Tulis Kantor (ATK)',
    icon: '📎',
    description: 'Pengadaan perlengkapan kantor, kertas, tinta printer, map, pulpen, dan kebutuhan administrasi.',
    examples: ['Kertas A4 / F4', 'Tinta printer Epson / Canon', 'Map folder & ordner', 'Pulpen, spidol, gunting, stapler'],
    requirements: ['Lampirkan struk / nota pembelian toko ATK'],
    keywords: ['atk', 'alat tulis', 'kertas', 'tinta', 'printer', 'map', 'pulpen', 'ordner', 'buku']
  },
  hr_ga_kebersihan: {
    nama: 'Kebersihan & Pantry',
    icon: '🧹',
    description: 'Perlengkapan kebersihan kantor, sabun, disinfektan, serta konsumsi harian pantry (galon air, kopi, teh, gula).',
    examples: ['Sabun cuci tangan & lantai', 'Air minum galon Aqua/Le Minerale', 'Kopi, teh, gula pantry', 'Tisu & kantong sampah'],
    requirements: ['Lampirkan struk belanja supermarket / warung'],
    keywords: ['kebersihan', 'pantry', 'galon', 'kopi', 'teh', 'gula', 'sabun', 'tisu', 'sapu', 'pel', 'snack']
  },
  hr_ga_keamanan: {
    nama: 'Keamanan & Lingkungan',
    icon: '💂',
    description: 'Iuran keamanan kawasan, biaya koordinasi pos satpam, dan sumbangan lingkungan kantor/workshop.',
    examples: ['Iuran keamanan bulanan RT/RW', 'Uang pembinaan pos satpam kawasan'],
    requirements: ['Kuitansi resmi pengurus keamanan / lingkungan'],
    keywords: ['keamanan', 'satpam', 'security', 'iuran warga', 'rt', 'rw', 'lingkungan']
  },
  hr_ga_sewa_gedung: {
    nama: 'Sewa Gedung & Properti',
    icon: '🏠',
    description: 'Biaya sewa tempat kerja, ruko kantor pusat, workshop, gudang penyimpanan, atau mess karyawan.',
    examples: ['Sewa ruko kantor tahunan', 'Sewa workshop per 6 bulan', 'Sewa rumah mess karyawan lapangan'],
    requirements: [
      'Wajib perjanjian sewa menyewa resmi',
      'Lampirkan kuitansi penerimaan dana oleh pemilik properti'
    ],
    keywords: ['sewa gedung', 'sewa ruko', 'sewa kantor', 'sewa mess', 'sewa gudang', 'properti', 'kontrak ruko']
  },
  it: {
    nama: 'IT & Teknologi',
    icon: '💻',
    description: 'Pengadaan infrastruktur IT, cloud server, lisensi software, hardware, dan jaringan.',
    examples: ['Sewa server AWS / VPS', 'Lisensi Microsoft Office / Windows', 'Beli SSD / RAM komputer', 'Kabel jaringan LAN & router'],
    requirements: [
      'Diutamakan untuk Departemen IT',
      'Lampirkan invoice / faktur dari vendor teknologi',
      'Pilih sub-kategori yang sesuai'
    ],
    keywords: ['it', 'komputer', 'server', 'software', 'lisensi', 'hardware', 'jaringan', 'hosting', 'cloud']
  },
  it_server_hosting: {
    nama: 'Server & Cloud Hosting',
    icon: '🖥️',
    description: 'Biaya langganan server cloud, VPS, domain web, web hosting, CDN, atau database online.',
    examples: ['Langganan AWS / Google Cloud', 'Perpanjangan Domain & SSL', 'Sewa VPS hosting sistem'],
    requirements: ['Invoice resmi provider cloud / hosting'],
    keywords: ['server', 'hosting', 'cloud', 'aws', 'gcp', 'domain', 'vps', 'ssl', 'database']
  },
  it_lisensi: {
    nama: 'Lisensi Software',
    icon: '💿',
    description: 'Pembelian atau perpanjangan lisensi aplikasi, sistem operasi, antivirus, dan tools produktivitas.',
    examples: ['Lisensi Microsoft 365', 'Antivirus Kaspersky / ESET', 'Lisensi Adobe Creative Cloud', 'Langganan Figma / GitHub'],
    requirements: ['Invoice resmi software vendor / kartu kredit corporate'],
    keywords: ['lisensi', 'software', 'aplikasi', 'microsoft', 'office', 'antivirus', 'adobe', 'figma', 'github']
  },
  it_hardware: {
    nama: 'Hardware & Komponen PC',
    icon: '🔧',
    description: 'Pembelian perangkat keras komputer, laptop, monitor, printer kantor, SSD, RAM, atau keyboard/mouse.',
    examples: ['SSD NVMe 1TB & RAM 16GB', 'Monitor 24 inch untuk staf', 'Printer Epson L3210', 'Keyboard & mouse logitech'],
    requirements: ['Nota / faktur toko komputer bergaransi'],
    keywords: ['hardware', 'komputer', 'laptop', 'ssd', 'ram', 'monitor', 'printer', 'mouse', 'keyboard', 'pc']
  },
  it_jaringan: {
    nama: 'Jaringan & Konektivitas',
    icon: '📡',
    description: 'Pengadaan kabel LAN, switch hub, access point Wi-Fi, crimping tool, dan instalasi jaringan.',
    examples: ['Kabel LAN Cat6 1 roll', 'Switch Hub 16 Port TP-Link', 'Access Point Ruijie / Unifi', 'Konektor RJ45'],
    requirements: ['Nota pembelian komponen jaringan'],
    keywords: ['jaringan', 'lan', 'kabel lan', 'switch', 'router', 'access point', 'wifi', 'rj45', 'mikrotik']
  },
  finance_pajak: {
    nama: 'Finance & Pajak',
    icon: '🧾',
    description: 'Administrasi perpajakan, biaya meterai, jasa konsultan pajak, dan biaya transaksi perbankan.',
    examples: ['Setoran PPh 21 / PPh 23 / PPN', 'Beli meterai elektronik / fisik', 'Biaya administrasi & provisi bank', 'Jasa auditor / konsultan pajak'],
    requirements: [
      'Wajib Kode Billing Pajak / Bukti Penerimaan Negara (BPN)',
      'Lampirkan rincian perhitungan pajak terkait'
    ],
    keywords: ['finance', 'pajak', 'pph', 'ppn', 'meterai', 'bank', 'provisi', 'audit', 'konsultan pajak', 'billing']
  },
  marketing: {
    nama: 'Marketing & Promosi',
    icon: '📣',
    description: 'Biaya iklan, promosi, pameran industri, cetak materi pemasaran, souvenir klien, dan jamuan prospek.',
    examples: ['Iklan Meta / Google Ads', 'Cetak brosur & katalog produk', 'Booth stand pameran konstruksi', 'Souvenir tumbler / agenda klien', 'Jamuan makan rapat prospek'],
    requirements: [
      'Lampirkan proposal kegiatan promosi / invoice iklan',
      'Lampirkan foto dokumentasi kegiatan / bukti tayang iklan'
    ],
    keywords: ['marketing', 'promosi', 'iklan', 'ads', 'brosur', 'katalog', 'pameran', 'booth', 'souvenir', 'entertain', 'klien', 'sales']
  },
  rnd: {
    nama: 'R&D (Riset & Pengembangan)',
    icon: '🔬',
    description: 'Biaya pengujian laboratorium, sampel bahan kimia/formula baru, dan sertifikasi mutu produk inovasi.',
    examples: ['Uji lab uji tarik / salt spray coating di Sucofindo', 'Pembelian bahan baku sampel riset formula', 'Sertifikasi uji kelayakan produk'],
    requirements: [
      'Lampirkan surat permohonan uji lab / invoice resmi lembaga uji',
      'Lampirkan ringkasan tujuan pengujian formula'
    ],
    keywords: ['rnd', 'r&d', 'riset', 'penelitian', 'uji lab', 'sucofindo', 'sampel', 'formula', 'sertifikasi produk']
  },
  legal_perizinan: {
    nama: 'Legal & Perizinan',
    icon: '⚖️',
    description: 'Biaya jasa notaris, perpanjangan izin usaha (NIB, SIUP), sertifikasi badan usaha, dan kepatuhan hukum.',
    examples: ['Akta notaris perubahan perusahaan', 'Perpanjangan Sertifikat Badan Usaha (SBU)', 'Izin operasional dinas lingkungan/K3', 'Jasa konsultan hukum'],
    requirements: [
      'Lampirkan invoice / kuitansi resmi kantor notaris / instansi terkait',
      'Cantumkan nomor berkas perizinan yang diproses'
    ],
    keywords: ['legal', 'hukum', 'notaris', 'izin', 'perizinan', 'nib', 'sbu', 'siup', 'amdal', 'pengacara', 'akta']
  },
  training: {
    nama: 'Training & Pelatihan',
    icon: '🎓',
    description: 'Biaya pelatihan, workshop, sertifikasi profesi karyawan (K3 Umum, Coating Inspector, Blasting, Manajemen).',
    examples: ['Sertifikasi BNSP Ahli K3 Umum', 'Kursus Coating Inspector NACE/SSPC', 'Training Perpajakan Brevet A/B', 'Workshop Leadership Tim'],
    requirements: [
      'Lampirkan brosur / invoice lembaga pelatihan resmi',
      'Cantumkan daftar nama karyawan peserta pelatihan'
    ],
    keywords: ['training', 'pelatihan', 'kursus', 'sertifikasi', 'k3', 'bnsp', 'nace', 'sspc', 'workshop', 'seminar', 'brevet']
  },
  csr: {
    nama: 'CSR (Sosial Perusahaan)',
    icon: '🤝',
    description: 'Pengeluaran tanggung jawab sosial perusahaan untuk masyarakat sekitar kantor atau area site proyek.',
    examples: ['Bantuan paket sembako warga sekitar pabrik', 'Sumbangan acara peringatan 17 Agustus desa', 'Santunan anak yatim piatu'],
    requirements: [
      'Lampirkan surat permohonan / proposal bantuan dari panitia/warga',
      'Wajib tanda terima & foto dokumentasi penyerahan bantuan'
    ],
    keywords: ['csr', 'sosial', 'sembako', 'sumbangan', 'bantuan', 'masyarakat', 'warga', 'desa', 'santunan', '17 agustus']
  },
  mobilisasi: {
    nama: 'Mobilisasi & Demobilisasi',
    icon: '🚚',
    description: 'Biaya pemindahan armada, alat berat, peralatan blasting, dan rombongan personel saat buka/tutup site proyek.',
    examples: ['Sewa truk trailer angkut genset & kompresor ke site', 'Tiket rombongan mobilisasi teknisi ke luar pulau', 'Demobilisasi alat proyek setelah selesai'],
    requirements: [
      'Wajib memilih Proyek Terkait',
      'Lampirkan surat jalan / invoice ekspedisi trailer',
      'Wajib nota / tiket resmi pengiriman'
    ],
    keywords: ['mobilisasi', 'demobilisasi', 'mobdemob', 'kirim alat', 'trailer', 'truk', 'ekspedisi alat', 'pindah site', 'buka proyek']
  },
  lain_lain: {
    nama: 'Lain-lain',
    icon: '📄',
    description: 'Pengeluaran khusus atau tak terduga yang tidak termasuk dalam klasifikasi kategori di atas.',
    examples: ['Biaya tak terduga lapangan', 'Pengeluaran khusus dengan persetujuan direksi'],
    requirements: [
      'Wajib menyertakan nota / bukti transaksi yang jelas',
      'Jelaskan alasan dan rincian kebutuhan pada Tujuan Pengajuan'
    ],
    keywords: ['lain-lain', 'lainnya', 'khusus', 'tak terduga', 'darurat']
  }
};

function findStaticClue(kode: string | null | undefined): BudgetCategoryClueItem | null {
  if (!kode) return null;
  const direct = BUDGET_CATEGORY_CLUES[kode];
  if (direct) return direct;
  const lower = kode.toLowerCase();
  for (const [k, v] of Object.entries(BUDGET_CATEGORY_CLUES)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

// Bentuk minimal kategori live yang dibutuhkan untuk clue (lihat BudgetCategory di budgetCategory.ts).
// Diketik longgar di sini supaya file ini tidak perlu import BudgetCategory (hindari siklus impor).
interface LiveClueSource {
  nama?: string | null;
  icon?: string | null;
  clue_icon?: string | null;
  clue_description?: string | null;
  clue_examples?: string[] | null;
  clue_requirements?: string[] | null;
  clue_keywords?: string[] | null;
}

/**
 * Mencari clue kategori berdasarkan kode. Bila `live` (kategori dari budget_category_config,
 * lihat R3 Audit Konfigurabilitas Lifecycle 16 Sep 2026) punya clue_description terisi, dipakai
 * sebagai sumber utama — supaya kategori baru langsung punya panduan tanpa deploy. Kategori yang
 * belum dimigrasi (clue_description kosong) tetap jatuh ke kamus statis di bawah.
 */
export function getCategoryClue(
  kode: string | null | undefined,
  live?: LiveClueSource | null
): BudgetCategoryClueItem | null {
  const staticClue = findStaticClue(kode);
  if (live?.clue_description) {
    return {
      nama: live.nama || staticClue?.nama || kode || '',
      icon: live.clue_icon || live.icon || staticClue?.icon || '📄',
      description: live.clue_description,
      examples: live.clue_examples?.length ? live.clue_examples : staticClue?.examples ?? [],
      requirements: live.clue_requirements?.length ? live.clue_requirements : staticClue?.requirements ?? [],
      keywords: live.clue_keywords?.length ? live.clue_keywords : staticClue?.keywords ?? []
    };
  }
  return staticClue;
}

/**
 * R6 (Gate Kategori Cocok) — pencarian kategori berbasis teks. Memakai keyword yang SAMA dengan gate G_KATEGORI_COCOK:
 * clue_keywords + strong_keywords dari budget_category_config (diatur di UI), plus kamus statis & contoh. Ketik "kir" -> Legal & Perizinan,
 * sehingga pengaju menemukan kategori yang tepat sejak awal (lebih efektif daripada diblokir belakangan).
 * Query beberapa kata: SEMUA kata harus cocok (mis. "perpanjang kir"). Sinonim: keur -> kir.
 */
const SEARCH_SYNONYM: Record<string, string> = { keur: 'kir', perpanjangan: 'perpanjang' };
const SEARCH_STOP = new Set(['untuk', 'dan', 'yang', 'dari', 'dengan', 'biaya', 'bayar', 'di', 'ke']);

function searchTokens(query: unknown): string[] {
  return String(query ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s&]/g, ' ')
    .split(/\s+/)
    .map((t) => SEARCH_SYNONYM[t] || t)
    .filter((t) => t.length >= 2 && !SEARCH_STOP.has(t));
}

/** Skor satu token terhadap kategori: 0 = tidak cocok. `hint` = kata kunci yang cocok (untuk ditampilkan). */
function scoreToken(cat: any, clue: any, tok: string): { s: number; hint: string | null } {
  const nama = (cat.nama || '').toLowerCase();
  const kode = (cat.kode || '').toLowerCase();
  if (nama.startsWith(tok)) return { s: 100, hint: null };
  if (nama.includes(tok) || kode.includes(tok)) return { s: 80, hint: null };
  const norm = (k: unknown) => String(k ?? '').toLowerCase().trim();
  const strong = (Array.isArray(cat.strong_keywords) ? cat.strong_keywords : []).map(norm).find((k) => k === tok || k.includes(tok));
  if (strong) return { s: 90, hint: strong };
  const live = (Array.isArray(cat.clue_keywords) ? cat.clue_keywords : []).map(norm).find((k) => k === tok || k.includes(tok));
  if (live) return { s: 60, hint: live };
  const stat = (clue?.keywords || []).map(norm).find((k) => k.includes(tok));
  if (stat) return { s: 50, hint: stat };
  if ((clue?.examples || []).some((e) => norm(e).includes(tok))) return { s: 30, hint: null };
  if (norm(cat.description).includes(tok) || norm(clue?.description).includes(tok)) return { s: 20, hint: null };
  return { s: 0, hint: null };
}

/** score 0 = tidak cocok; hint = keyword yang cocok (bila hit lewat keyword). */
export function categorySearchResult(cat: any, query: string): { score: number; hint: string | null } {
  const toks = searchTokens(query);
  if (!toks.length) return { score: 1, hint: null };
  const clue = getCategoryClue(cat.kode, cat);
  let total = 0;
  let hint: string | null = null;
  for (const tok of toks) {
    const r = scoreToken(cat, clue, tok);
    if (r.s === 0) return { score: 0, hint: null };
    total += r.s;
    if (r.hint && !hint) hint = r.hint;
  }
  return { score: total / toks.length, hint };
}

export function matchCategorySearch(cat: any, query: string): boolean {
  if (!query || !query.trim()) return true;
  return categorySearchResult(cat, query).score > 0;
}
