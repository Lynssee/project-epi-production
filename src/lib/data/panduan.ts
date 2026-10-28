// src/lib/data/panduan.ts
// Konten dokumentasi user untuk semua modul Dashboard Lapangan

export interface PanduanLangkah {
  judul: string;
  isi: string;
  tips?: string;
  /** Fase 1 — Rencana v2 Panduan Auto-Sync (§3): blok visual terstruktur, dirender PanduanBlocks.svelte. Kosong/absen = fallback ke `isi`. */
  blocks?: any[] | null;
  /**
   * Fase 5 — Rencana v2 Panduan Auto-Sync (menutup celah K3): kunci stabil
   * langkah, diturunkan otomatis dari slug judul (lihat scripts/migrate-
   * panduan-to-directus.mjs). project-epi TIDAK punya href per-langkah di
   * tours.ts (selalu memakai modul.href, tidak ada celah index seperti
   * tours.js erp-epi-1) — field ini ada untuk PARITAS & jaga-jaga andai
   * suatu saat tours.ts menambah href per langkah.
   */
  step_key?: string | null;
}

export interface PanduanFaq {
  tanya: string;
  jawab: string;
}

export interface ModulPanduan {
  id: string;
  nama: string;
  kategori: string;
  deskripsi: string;
  icon: string;
  href: string;
  langkah: PanduanLangkah[];
  faq: PanduanFaq[];
  /** Fase 4 — Rencana v2 Panduan Auto-Sync (§2 Lapis 2): kontrak konten dibaca Mesin Sinkron. */
  refs?: { rute?: string[]; koleksi?: string[]; nav_key?: string[] } | null;
}

export const kategoriModul = [
  { id: 'project', label: 'Project', emoji: '📁' },
  { id: 'inventory', label: 'Inventory', emoji: '📦' },
  { id: 'maintenance', label: 'Maintenance', emoji: '🔧' },
  { id: 'support', label: 'Support & Helpdesk', emoji: '🎧' },
  { id: 'sales', label: 'Sales Lapangan', emoji: '🤝' },
  { id: 'hrga', label: 'HRD & GA', emoji: '🏢' },
  { id: 'ess', label: 'Portal Karyawan', emoji: '👤' },
  { id: 'umum', label: 'Umum & Keamanan', emoji: '🛡️' },
];

export const modulDokumentasi: ModulPanduan[] = [
  {
    id: 'laporan-harian',
    nama: 'Laporan Harian',
    kategori: 'project',
    deskripsi: 'Panduan mengisi laporan harian proyek oleh Project Leader.',
    icon: 'clipboard-list',
    href: '/laporan',
    refs: { rute: ['/laporan'], koleksi: ['reports'] },
    langkah: [
      {
        judul: '1. Mengisi Laporan Harian',
        isi: `Buka menu Laporan → pilih proyek yang sedang dikerjakan → laporan dibagi 4 tab:
1. Progress — pekerjaan yang dikerjakan hari ini + foto dokumentasi.
2. Material — material yang terpakai hari ini.
3. Tenaga — daftar pekerja yang hadir + foto bukti absensi lapangan.
4. Peralatan — alat yang dipakai/dimobilisasi.
5. Isi juga kondisi cuaca hari ini (wajib).
6. Simpan atau kirim laporan.`,
        tips: 'Lampirkan foto yang jelas untuk memudahkan verifikasi oleh Admin/Manager.',
        blocks: [
          {
            type: 'badges',
            items: [
              { teks: 'Foto Progress Wajib', nada: 'peringatan' },
              { teks: 'Foto Absensi Wajib', nada: 'peringatan' }
            ]
          },
          {
            type: 'penting',
            isi: 'Laporan TIDAK BISA dikirim tanpa: minimal 1 item Progress + foto bukti progress, minimal 1 item Material, minimal 1 pekerja di tab Tenaga + foto bukti absensi, dan kolom Cuaca terisi. Sistem menandai tab mana yang belum lengkap saat tombol kirim ditekan.'
          }
        ]
      }
    ],
    faq: [
      {
        tanya: 'Apakah laporan harian bisa diedit setelah dikirim?',
        jawab: 'Bisa diedit selama status laporan belum diapprove oleh manajer/admin.'
      }
    ]
  },
  {
    id: 'borongan-lapangan',
    nama: 'Manpower Borongan (Lapangan)',
    kategori: 'project',
    deskripsi: 'Panduan bagi Project Leader untuk memeriksa termin borongan, memverifikasi progres fisik (BAP ringan), dan syarat termin pelunasan.',
    icon: 'users',
    href: '/proyek',
    refs: { rute: ['/proyek'], koleksi: ['manpower_borongan_termin'], gate: ['G_BAP_BORONGAN'] },
    langkah: [
      {
        judul: '1. Memeriksa Daftar Termin Borongan Proyek',
        isi: `1. Buka menu Proyek → pilih proyek yang sedang aktif.
2. Buka tab/panel "Manpower Borongan".
3. Sistem menampilkan daftar pekerja borongan beserta ringkasan nilai kontrak, total terbayar, sisa pembayaran, dan kartu rincian termin (Termin 1 / DP, Termin 2, Pelunasan).
4. Setiap kartu menampilkan status termin (Direncanakan / Progres Terverifikasi / Diajukan ke Finance / Disetujui / Lunas), target progres fisik (%), dan nominal termin.`,
        tips: 'Perhatikan target progress_required pada kartu termin untuk mengetahui kapan verifikasi dapat dilakukan.'
      },
      {
        judul: '2. Verifikasi Progres & BAP Ringan Lapangan',
        isi: `Saat pekerjaan pada termin terkait telah rampung dikerjakan di lapangan:
1. Temukan kartu termin yang berstatus "Direncanakan" (Draft).
2. Klik tombol "Verifikasi Progres".
3. Formulir verifikasi akan terbuka:
   • Unggah Foto Bukti Fisik: Klik ambil foto atau upload foto hasil pekerjaan di site (foto otomatis dikompres menjadi ±200-400 KB oleh sistem agar hemat kuota).
   • Catatan Hasil Kerja: Isi ringkasan hasil pekerjaan fisik, mutu kerja, atau kendala yang telah diselesaikan (berfungsi sebagai BAP ringan).
   • Progres Fisik Proyek (%): Masukkan capaian persentase progres fisik proyek terkini.
4. Klik "Simpan Verifikasi" → status termin berubah menjadi "Progres Terverifikasi" (Verified).
5. Admin di kantor pusat kini dapat memproses pengajuan pencairan dana ke Finance.`,
        tips: 'Pastikan foto bukti fisik fokus pada lingkup pekerjaan yang menjadi milestone termin yang diverifikasi.'
      },
      {
        judul: '3. Verifikasi Khusus Termin Pelunasan',
        isi: `Pada termin terakhir yang bertanda "Pelunasan":
1. Pengecekan Alat & Inventaris Proyek:
   • Periksa apakah seluruh peralatan kerja, mesin bantu, kunci, atau inventaris proyek yang dipinjam pekerja/mandor telah dikembalikan ke site/gudang dalam kondisi lengkap.
2. Konfirmasi Bebas Kendala:
   • Pastikan seluruh punch list pekerjaan telah tuntas dan tidak ada cacat hasil kerja yang masih harus diperbaiki.
3. Laporan Kerusakan Barang (Jika Ada):
   • Jika ada alat atau material proyek yang rusak/hilang karena kelalaian pekerja, laporkan kepada Admin ERP agar dapat dikenakan sanksi denda pemotongan pada pengajuan pelunasan ke Finance.`,
        tips: 'Jangan menyelesaikan verifikasi pelunasan sebelum seluruh inventaris proyek dipastikan lengkap di lapangan.'
      }
    ],
    faq: [
      {
        tanya: 'Mengapa tombol verifikasi tidak bisa diklik atau berwarna abu-abu?',
        jawab: 'Tombol verifikasi hanya aktif untuk termin yang berstatus "Direncanakan" (Draft). Jika termin sudah berstatus "Verified", "Submitted", atau "Paid", verifikasi sudah tersimpan dan sedang diproses ke Finance.'
      },
      {
        tanya: 'Apakah foto bukti verifikasi bisa lebih dari satu?',
        jawab: 'Ya, Anda dapat mengunggah beberapa foto dokumentasi sekaligus untuk memperkuat bukti bahwa pekerjaan milestone termin tersebut benar-benar telah selesai.'
      },
      {
        tanya: 'Bagaimana jika termin sebelumnya belum lunas?',
        jawab: 'Project Leader tetap bisa memverifikasi progres fisik di lapangan, namun Admin ERP di kantor baru bisa mengajukan pencairan termin ke Finance setelah termin sebelumnya disetujui/dilunasi oleh Finance (kunci sekuensial).'
      }
    ]
  },
  {
    id: 'stock-lapangan',
    nama: 'Stok Lapangan',
    kategori: 'inventory',
    deskripsi: 'Pencatatan stok material di site/lokasi proyek: antrian gudang pusat, persiapan bahan baku/finish good, barang masuk, hasil produksi, opname harian, komplain, dan cek area (genba).',
    icon: 'boxes',
    href: '/stock-lapangan',
    refs: {
      rute: ['/stock-lapangan', '/stock-lapangan/antrian', '/stock-lapangan/persiapan', '/stock-lapangan/masuk', '/stock-lapangan/output', '/stock-lapangan/opname', '/stock-lapangan/komplain', '/stock-lapangan/cek-area'],
      nav_key: ['stock-lapangan']
    },
    langkah: [
      {
        judul: '1. Antrian Gudang Pusat & Persiapan',
        isi: `1. Buka Stok Lapangan → "Antrian Gudang Pusat" — daftar packing list yang perlu disiapkan (hanya tampil untuk gudang pusat)
2. "Persiapan" → siapkan bahan baku atau finish good sesuai permintaan produksi/pengiriman
3. Ambil barang sesuai daftar pick, tandai selesai per baris.`,
        tips: 'Badge angka di menu Antrian menunjukkan jumlah packing list yang masih menunggu disiapkan.'
      },
      {
        judul: '2. Barang Masuk & Hasil Produksi',
        isi: `Barang Masuk: "Barang Masuk" → catat penerimaan barang, sesuaikan dengan Surat Jalan, stok bertambah otomatis begitu disimpan.
Hasil Produksi: "Hasil Produksi" → catat finish good yang keluar dari lini produksi, stok bertambah otomatis begitu disimpan.`,
        tips: ''
      },
      {
        judul: '3. Opname Harian (Stok Fisik vs Sistem)',
        isi: `1. Buka "Opname Harian" → pilih gudang/proyek
2. Hitung stok fisik per item, bandingkan dengan angka sistem
3. Lampirkan foto bukti untuk item yang selisih
4. Submit — sistem membandingkan selisih terhadap ambang toleransi.`,
        tips: 'Selisih di luar toleransi TIDAK langsung mengubah stok — masuk antrean menunggu approval admin. Selisih dalam toleransi baru langsung disesuaikan.',
        blocks: [
          {
            type: 'badges',
            items: [{ teks: 'Selisih Besar = Approval Wajib', nada: 'peringatan' }]
          },
          {
            type: 'penting',
            teks: 'Opname bukan koreksi stok instan untuk semua kasus. Hanya selisih KECIL (dalam ambang toleransi) yang langsung menyesuaikan stok. Selisih BESAR ditahan berstatus "menunggu approval admin" — stok sistem tetap seperti semula sampai admin menyetujui, supaya selisih besar tidak bisa dipakai menutupi kehilangan barang tanpa sepengetahuan admin.'
          }
        ]
      },
      {
        judul: '4. Komplain Barang & Cek Area (Genba)',
        isi: `Komplain: "Komplain Barang" → laporkan barang salah kirim atau cacat mutu SETELAH diterima (beda dari checklist penerimaan biasa)
Cek Area: "Cek Area / Genba" → verifikasi isi rak fisik sesuai QR lokasi gudang, untuk audit penempatan barang.`,
        tips: ''
      }
    ],
    faq: []
  },
  {
    id: 'preventive-maintenance',
    nama: 'Preventive Maintenance',
    kategori: 'maintenance',
    deskripsi: 'Panduan pengisian ceklis pemeliharaan berkala untuk peralatan proyek.',
    icon: 'tool',
    href: '/preventive',
    refs: {
      rute: ['/preventive', '/preventive/p2h', '/preventive/pm', '/preventive/riwayat', '/preventive/audit-penempatan'],
      nav_key: ['preventive-maintenance']
    },
    langkah: [
      {
        judul: '1. Memilih Unit Peralatan',
        isi: `1. Buka menu Maintenance > Preventive Maintenance
2. Pilih peralatan yang akan diinspeksi
3. Periksa riwayat maintenance sebelumnya.`,
      },
      {
        judul: '2. Mengisi Checklist Maintenance',
        isi: `1. Isi form pemeriksaan sesuai kondisi fisik alat
2. Berikan catatan jika ada komponen yang perlu perbaikan/penggantian
3. Tanda tangan digital WAJIB diisi sebelum kirim
4. Kirim hasil ceklis — satu unit hanya bisa punya SATU P2H per tanggal, submit kedua di hari yang sama akan ditolak.`,
        tips: 'HM (jam operasi) yang diinput di P2H TIDAK dikunci anti-rollback — beda dari fitur "Quick Log HM" terpisah yang menolak angka lebih kecil dari rekor terakhir. Kalau salah ketik HM di P2H, laporkan ke admin untuk koreksi manual.',
        blocks: [
          {
            type: 'badges',
            items: [{ teks: 'P2H Anti-Bypass', nada: 'bahaya' }]
          },
          {
            type: 'penting',
            teks: 'Checklist tidak boleh kosong dan tanda tangan wajib diisi — sistem menolak submit kalau salah satu belum lengkap. Untuk item yang di-set wajib foto, submit juga ditolak tanpa foto bukti.'
          }
        ]
      },
      {
        judul: '3. Verifikasi Komponen Kritis Equipment (CLM)',
        isi: `Saat melakukan P2H pada unit seperti kompresor, genset, atau armada, periksa komponen bertanda QR (seperti aki atau ban).

Langkah verifikasi di lapangan:
1. Buka formulir P2H untuk equipment terkait di menu Preventive > P2H Harian (misal: /preventive/p2h/[equipment_id]).
2. Temukan bagian "Verifikasi Komponen Kritis" di dalam halaman inspeksi.
3. Sistem akan otomatis menampilkan daftar komponen yang seharusnya terpasang pada unit tersebut (contoh: Aki GS Astra #105).
4. Arahkan kamera untuk scan kode QR fisik (berformat EPI:COMP:<id>) atau masukkan kode secara manual jika stiker kotor/sulit di-scan.
5. Tentukan kondisi fisik komponen: "Baik", "Perlu Perhatian", atau "Rusak".
6. Jika kode tidak cocok dengan equipment ini, sistem mencatat status "Mismatch" sebagai audit investigasi (misal aki tertukar tanpa izin).`,
        tips: 'Mekanik di lapangan hanya memverifikasi identitas dan kondisi fisik. Nilai rupiah atau harga perolehan aki dikelola oleh tim admin kantor di erp-epi.'
      }
    ],
    faq: [
      {
        tanya: 'Apa yang harus dilakukan jika scanner QR menampilkan status "Mismatch"?',
        jawab: 'Status mismatch berarti komponen fisik yang terpasang di unit tidak sama dengan data yang tercatat di sistem (misal aki tertukar saat servis darurat). Catat di keterangan dan laporkan ke supervisor/admin maintenance agar dilakukan pembaruan mutasi di sistem.'
      },
      {
        tanya: 'Bagaimana jika stiker QR pada aki sobek atau tidak terbaca?',
        jawab: 'Gunakan opsi input manual pada form Verifikasi Komponen Kritis dengan mengetikkan format EPI:COMP:<id> sesuai nomor ID yang tertera di label, lalu minta stiker cetak ulang ke admin maintenance.'
      }
    ]
  },
  {
    id: 'clm-lapangan',
    nama: 'Verifikasi Komponen Alat (CLM)',
    kategori: 'maintenance',
    deskripsi: 'Panduan teknisi & mekanik lapangan untuk verifikasi barcode QR dan kondisi fisik komponen terpasang pada equipment (seperti aki kompresor) saat P2H.',
    icon: 'qrcode',
    href: '/preventive',
    refs: { rute: ['/preventive'], koleksi: ['component_unit', 'component_inspection_log'] },
    langkah: [
      {
        judul: '1. Pengecekan Komponen Kritis saat P2H',
        isi: `Setiap equipment utama (misal: Kompresor, Genset, Excavator, Kendaraan Operasional) memiliki komponen kritis yang terdaftar secara individual dengan nomor identifikasi unik, terutama Aki dan Ban.

Pemeriksaan komponen ini dilakukan bersamaan dengan jadwal inspeksi harian (P2H).

Tujuan Verifikasi:
• Memastikan komponen yang terpasang adalah unit yang sah dan sesuai aset perusahaan.
• Mencegah tertukarnya aki/komponen berharga tinggi antar-alat atau antar-site tanpa pencatatan.
• Memantau kondisi kelayakan fisik aki secara berkala sebelum terjadi mogok/breakdown di lokasi kerja.`,
      },
      {
        judul: '2. Cara Memindai QR Code Komponen (EPI:COMP:<id>)',
        isi: `1. Pada halaman P2H Equipment (/preventive/p2h/[equipment_id]), gulir ke bagian "Verifikasi Komponen Kritis".
2. Daftar komponen yang terikat pada equipment tersebut akan muncul secara otomatis.
3. Klik tombol Scan QR Kamera:
   - Arahkan kamera ponsel pintar ke stiker QR yang tertempel di bodi aki.
   - Format standar stiker adalah EPI:COMP:<id> (contoh: EPI:COMP:105).
4. Jika kamera tidak dapat membaca akibat stiker tertutup oli/debu:
   - Bersihkan permukaan stiker dengan kain kering.
   - Atau gunakan kolom "Input Kode Manual" dan ketik format EPI:COMP:<id> sesuai nomor yang terbaca dengan mata.`,
        tips: 'Pastikan pencahayaan cukup saat memindai QR di dalam kompartemen mesin kompresor.'
      },
      {
        judul: '3. Memilih Status Kondisi Fisik',
        isi: `Setelah kode komponen terverifikasi cocok ("Match"), tentukan salah satu kondisi fisik:
• Baik: Aki bersih, kutub terminal tidak berkerak, voltase/daya start kuat, tidak kembung.
• Perlu Perhatian: Terminal mulai berkerak putih, air aki berkurang (aki basah), atau mulai lambat saat starter pertama. Beri catatan tindak lanjut.
• Rusak: Aki drop tidak menyimpan setrum, bodi retak/kembung parah, atau tidak berfungsi.

Jika memilih "Perlu Perhatian" atau "Rusak", lampirkan foto dan buat Tiket Masalah atau ajukan pengisian air/servis aki.`,
      },
      {
        judul: '4. Penanganan Status "Mismatch" (Komponen Tertukar)',
        isi: `Jika kode QR yang di-scan tidak terdaftar pada equipment kompresor tersebut:
1. Sistem akan menandai status sebagai "Mismatch" (Tidak Cocok) dan mencatatnya ke log audit server.
2. Jangan paksa unit bekerja bila ada indikasi komponen milik proyek lain.
3. Hubungi Leader Proyek atau Admin Maintenance di kantor pusat untuk mengonfirmasi apakah ada riwayat peminjaman/mutasi darurat.
4. Admin di kantor akan memproses mutasi resmi di erp-epi pada tab Perpindahan agar data tersinkronisasi.`,
        tips: 'Jangan pernah memindahkan aki antar-kompresor tanpa izin supervisor atau tanpa membuat laporan mutasi.'
      }
    ],
    faq: [
      {
        tanya: 'Kenapa saya tidak bisa melihat harga atau nilai aki di aplikasi ini?',
        jawab: 'Aplikasi project-epi dikhususkan untuk operasional lapangan. Informasi harga perolehan, nilai penyusutan, dan akuntansi dikelola secara terpusat oleh tim finance/admin di erp-epi.'
      },
      {
        tanya: 'Apakah P2H tetap bisa disubmit jika ada komponen yang Mismatch?',
        jawab: 'P2H tetap bisa dikirim agar operasional harian tidak terhenti, namun status mismatch akan terekam permanen pada log audit inspeksi untuk ditindaklanjuti oleh supervisor.'
      }
    ]
  },
  {
    id: 'hrga-hub',
    nama: 'Master Modul HRD & GA',
    kategori: 'hrga',
    deskripsi: 'Panduan pusat layanan General Affairs (GA), satpam, armada kendaraan, dan manpower.',
    icon: 'building-skyscraper',
    href: '/hrga/hub',
    refs: { rute: ['/hrga/hub'] },
    langkah: [
      {
        judul: '1. Mengakses Hub HRD & GA',
        isi: `1. Buka menu Departemen > HRD & GA pada sidebar.
2. Anda akan diarahkan ke Hub HRD & GA yang merangkum:
   - General Affairs (GA Checklist, Permintaan Layanan ATK/Fasilitas, Fleet Booking, Satpam)
   - Manpower & Regu Lapangan
   - Legalitas & Hak Cipta Perusahaan.`,
      }
    ],
    faq: []
  },
  {
    id: 'ga-checklist',
    nama: 'GA Checklist Fasilitas & K3',
    kategori: 'hrga',
    deskripsi: 'Panduan inspeksi berkala kebersihan, fasilitas kerja, dan housekeeping kantor/lapangan.',
    icon: 'checklist',
    href: '/ga-checklist',
    refs: { rute: ['/ga-checklist'], koleksi: ['ga_checklist_schedule', 'security_checkpoint'] },
    langkah: [
      {
        judul: '1. Mengisi Checklist Fasilitas GA',
        isi: `1. Buka menu HRD & GA > GA Checklist Fasilitas & K3 (atau scan QR lokasi fasilitas)
2. Pilih area/fasilitas yang diperiksa
3. Isi status checklist (Bersih, Berfungsi, Rusak, Perlu Perbaikan)
4. Lampirkan foto kondisi jika ditemukan ketidaksesuaian
5. Submit hasil checklist.`,
      }
    ],
    faq: []
  },
  {
    id: 'ga-request',
    nama: 'Permintaan Layanan GA',
    kategori: 'hrga',
    deskripsi: 'Panduan mengajukan permintaan ATK, perbaikan fasilitas kerja, dan kebutuhan umum kantor.',
    icon: 'clipboard-list',
    href: '/ga-request',
    refs: { rute: ['/ga-request'], koleksi: ['ga_request'] },
    langkah: [
      {
        judul: '1. Membuat Pengajuan Layanan GA',
        isi: `1. Buka menu HRD & GA > Permintaan Layanan GA
2. Klik tombol "Buat Permintaan"
3. Pilih kategori kebutuhan (ATK, Perbaikan AC/Listrik, Kebersihan, dll.)
4. Tuliskan deskripsi detail dan tingkat urgensi
5. Klik "Kirim Pengajuan".`,
      }
    ],
    faq: []
  },
  {
    id: 'ga-barang-ruangan',
    nama: 'Barang per Ruangan',
    kategori: 'hrga',
    deskripsi: 'Melihat daftar barang (perabotan, elektronik, peralatan) yang tercatat di tiap ruangan kantor/workshop, lewat scan QR patroli di pintu atau memilih ruangan dari daftar.',
    icon: 'package',
    href: '/ruangan',
    refs: {
      rute: ['/ruangan', '/ruangan/[areaId]'],
      koleksi: ['ga_areas', 'ga_asset', 'security_checkpoint', 'ga_room_check']
    },
    langkah: [
      {
        judul: '1. Membuka Daftar Barang Sebuah Ruangan',
        isi: `1. Buka menu HRD & GA > Barang per Ruangan (atau scan QR patroli yang tertempel di pintu ruangan).
2. Kalau memilih dari daftar: cari nama ruangan, lalu ketuk ruangannya.
3. Halaman ruangan menampilkan daftar barang dikelompokkan per kategori beserta kondisinya (Baik / Perlu perbaikan / Rusak).
4. Baris "Dicek" menunjukkan kapan terakhir ada petugas mencocokkan barang fisik dengan daftar; "Patroli" menunjukkan scan QR terakhir di pintu.`,
        tips: 'Daftar ini sesuai catatan GA. Kalau barang di ruangan tidak sama dengan daftar, laporkan ke Admin GA — jangan memindahkan barang diam-diam.'
      },
      {
        judul: '2. Mencari Sebuah Barang Ada di Ruangan Mana',
        isi: `1. Di halaman Barang per Ruangan, gunakan kotak "Cari barang … ada di ruangan mana".
2. Ketik minimal 2 huruf nama barang (mis. "proyektor").
3. Hasil menampilkan ruangan tempat barang itu tercatat — ketuk untuk membuka ruangannya.`,
        tips: 'Berguna untuk barang yang sering berpindah seperti proyektor, tangga lipat, atau troli.'
      }
    ],
    faq: [
      {
        tanya: 'Kenapa nilai rupiah barang tidak muncul di HP saya?',
        jawab: 'Nilai rupiah barang sengaja disembunyikan di dashboard lapangan dan hanya terlihat oleh HR Manager & Superadmin. Ini bisa diatur oleh Admin di Setelan GA.'
      },
      {
        tanya: 'Ruangan saya tertulis "belum ada QR". Apa artinya?',
        jawab: 'Belum ada stiker QR patroli untuk ruangan itu. Tim GA akan mencetak dan menempelkannya. Sementara itu, ruangan tetap bisa dibuka lewat daftar.'
      }
    ]
  },
  {
    id: 'fleet-booking',
    nama: 'Peminjaman Kendaraan (Fleet)',
    kategori: 'hrga',
    deskripsi: 'Panduan booking armada kendaraan operasional untuk tugas luar kota atau mobilitas proyek.',
    icon: 'car',
    href: '/fleet-booking',
    refs: { rute: ['/fleet-booking'], koleksi: ['fleet_bookings'] },
    langkah: [
      {
        judul: '1. Mengajukan Peminjaman Kendaraan',
        isi: `1. Buka menu HRD & GA > Peminjaman Kendaraan
2. Pilih tanggal dan estimasi durasi penggunaan
3. Pilih unit kendaraan yang tersedia
4. Tentukan tujuan perjalanan dan jumlah penumpang
5. Submit permohonan booking untuk diproses oleh admin GA.`,
      }
    ],
    faq: []
  },
  {
    id: 'ess',
    nama: 'Portal Karyawan (ESS)',
    kategori: 'ess',
    deskripsi: 'Panduan melakukan absensi, pengajuan cuti, lembur, dan melihat slip gaji.',
    icon: 'clock',
    href: '/ess',
    refs: {
      rute: ['/ess'],
      koleksi: ['absensi_harian', 'projects', 'site_checkin_settings'],
      nav_key: ['ess']
    },
    langkah: [
      {
        judul: '1. Melakukan Absensi Kehadiran',
        isi: `1. Buka menu Portal Karyawan > Absensi Masuk / Pulang
2. Pastikan GPS/Lokasi perangkat Anda menyala
3. Klik "Clock In" untuk absen masuk
4. Untuk absen pulang, klik "Clock Out" di halaman yang sama`,
        blocks: [
          {
            type: 'badges',
            items: [{ teks: 'Geofencing per Lokasi', nada: 'info' }]
          },
          {
            type: 'penting',
            isi: 'Radius geofencing TIDAK satu angka baku untuk semua tempat — tiap lokasi absensi kantor/site punya radiusnya sendiri (kolom radius_m/geo_radius_m per lokasi/per proyek). Kalau lokasi belum diisi radius khusus, sistem memakai radius default yang diatur admin (saat ini 300 meter, bisa diubah admin kapan saja) — jadi absen ditolak "di luar radius" bisa berarti radius lokasi itu memang disetel lebih kecil dari 300m, bukan bug.'
          }
        ]
      },
      {
        judul: '2. Mengajukan Cuti',
        isi: `1. Buka menu Portal Karyawan > Cuti & Izin
2. Klik tombol "Ajukan Cuti"
3. Pilih tanggal mulai dan akhir cuti
4. Masukkan alasan cuti dengan jelas
5. Submit pengajuan. Anda dapat memantau status pengajuan (Pending, Approved, Rejected) di daftar cuti.`,
      }
    ],
    faq: [
      {
        tanya: 'Mengapa saya tidak bisa absen?',
        jawab: 'Pastikan Anda memberikan izin akses lokasi (GPS) pada browser/aplikasi Anda.'
      }
    ]
  },
  {
    id: 'satpam',
    nama: 'Keamanan (Satpam)',
    kategori: 'hrga',
    deskripsi: 'Panduan khusus untuk tim keamanan dalam melakukan pencatatan di lapangan: gate log, tamu, patroli, insiden, deposit HP, dan serah-terima shift.',
    icon: 'shield',
    href: '/satpam',
    refs: {
      rute: ['/satpam', '/satpam/gate', '/satpam/tamu', '/satpam/patroli', '/satpam/insiden', '/satpam/deposit-hp', '/satpam/serah-terima'],
      koleksi: ['security_gate_person_log', 'security_gate_goods_log', 'security_visitor', 'security_patrol_log', 'security_patrol_route', 'security_checkpoint']
    },
    langkah: [
      {
        judul: '1. Gate Log — Keluar/Masuk Orang & Barang',
        isi: `Catat setiap orang dan barang yang keluar/masuk area:
1. Buka Satpam > Gate Log.
2. Pilih tipe: Orang atau Barang.
3. Untuk barang keluar (mis. surat jalan): pilih SJ terkait, cocokkan item.
4. Simpan — log tetap "terbuka" sampai ada catatan kembali/masuk pasangannya.`,
        tips: 'Log orang/barang yang belum ada pasangan keluar-masuknya akan tetap tampil sebagai "belum kembali" — jangan biarkan menumpuk, itu tanda ada yang lupa dicatat.'
      },
      {
        judul: '2. Tamu & Kendaraan',
        isi: `Pendataan tamu yang berkunjung:
1. Buka Satpam > Tamu.
2. Catat identitas tamu, tujuan kunjungan, dan kendaraan (bila bawa kendaraan).
3. Tamu yang masih di lokasi tampil di daftar "Tamu di Dalam" — tandai keluar saat tamu pulang.`
      },
      {
        judul: '3. Patroli / Cleaning',
        isi: `Rute patroli terjadwal dengan checkpoint QR:
1. Buka Satpam > Patroli.
2. Pilih rute patroli aktif.
3. Scan QR tiap checkpoint sepanjang rute sesuai urutan.
4. Hasil patroli terakhir (checkpoint mana yang terlewat/terlambat) tampil di halaman yang sama.`,
        tips: 'Checkpoint yang di-skip tetap tercatat sebagai terlewat — bukan dianggap tidak terjadi.'
      },
      {
        judul: '4. Insiden',
        isi: `Laporkan kejadian tidak biasa (kerusakan, kehilangan, gangguan keamanan, dll):
1. Buka Satpam > Insiden.
2. Isi kronologi, lokasi, dan lampirkan foto bila ada.
3. Simpan — insiden masuk ke rekap untuk ditindaklanjuti HRD/GA.`
      },
      {
        judul: '5. Deposit HP',
        isi: `Titip HP karyawan (area yang mewajibkan bebas HP):
1. Buka Satpam > Deposit HP — kolom scan otomatis aktif (fokus kursor).
2. Scan/ketik nomor badge karyawan.
3. Pilih loker, konfirmasi setor.
4. Saat karyawan mengambil kembali, scan ulang badge yang sama untuk proses pengambilan.
5. Daftar "Belum Setor Hari Ini" dan "Belum Diambil Hari Ini" membantu memantau kepatuhan.`,
        tips: 'Scan badge yang sama dipakai untuk DUA aksi berbeda (setor vs ambil) — sistem otomatis mendeteksi mana yang berlaku berdasar status HP karyawan itu hari ini.'
      },
      {
        judul: '6. Serah-Terima Shift',
        isi: `Catat estafet tugas antar shift satpam:
1. Buka Satpam > Serah-Terima Shift.
2. Isi catatan kondisi/temuan yang perlu diteruskan ke shift berikutnya.
3. Simpan sebelum shift berakhir — shift berikutnya melihat catatan ini saat mulai tugas.`
      }
    ],
    faq: []
  },
  {
    id: 'tds-dokumen-teknis',
    nama: 'Dokumen Teknis (TDS & MSDS)',
    kategori: 'inventory',
    deskripsi: 'Panduan mengenai dokumen spesifikasi teknis (TDS) dan keselamatan bahan (MSDS).',
    icon: 'file-text',
    href: '/stock-lapangan',
    refs: { rute: ['/stock-lapangan'], koleksi: ['tds_msds_documents'] },
    langkah: [
      {
        judul: '1. Informasi TDS & MSDS Produk',
        isi: `TDS (Technical Data Sheet) berisi data teknis cat (daya sebar, waktu kering, viskositas, perbandingan campuran hardener/thinner).
MSDS (Material Safety Data Sheet) memuat panduan keselamatan kerja, APD yang wajib dipakai, dan tindakan darurat P3K.

Jika membutuhkan dokumen fisik atau PDF TDS/MSDS untuk verifikasi di lapangan:
1. Tanyakan kepada Admin Proyek atau Tim R&D melalui ERP Pusat (menu R&D > TDS & MSDS).
2. Anda juga dapat menanyakan spesifikasi produk langsung ke Asisten AI di aplikasi.`,
        tips: 'Selalu periksa instruksi TDS mengenai rasio pencampuran cat & thinner sebelum memulai aplikasi coating di lapangan.'
      }
    ],
    faq: [
      {
        tanya: 'Di mana saya bisa melihat rasio mixing atau waktu recoat cat?',
        jawab: 'Informasi rasio mixing, pot life, dan interval recoat tertera lengkap di dokumen TDS (Technical Data Sheet) produk terkait.'
      }
    ]
  },
  {
    id: 'sop-aplikasi-foxapaint',
    nama: 'SOP Aplikasi Cat Foxapaint',
    kategori: 'project',
    deskripsi: 'Standar operasional pengecatan & protective coating Foxapaint: persiapan substrat, aturan cuaca & dew point, pencampuran 2K, pot life, jeda overcoating, dan pemecahan masalah.',
    icon: 'paint',
    href: '/produk',
    refs: { rute: ['/produk', '/rnd'], koleksi: ['foxapaint_product_specs', 'tds_msds_documents'] },
    langkah: [
      {
        judul: '1. Persiapan Permukaan (Surface Preparation)',
        isi: `Keberhasilan sistem pelapisan 80% ditentukan oleh kualitas permukaan sebelum dicat:
1. Substrat Baja / Besi (Steel):
   • Bersihkan minyak, gemuk, dan oli dengan solvent degreaser sesuai standar SSPC-SP 1.
   • Lakukan Sandblasting / Grit Blasting hingga standar Sa 2.5 (ISO 8501-1) untuk proteksi berat, dengan profil kekasaran tajam (roughness profile) 40–75 µm.
   • Untuk pemeliharaan ringan tanpa blasting, minimal bersihkan karat dengan sikat kawat mekanik standar St 3 (SSPC-SP 3).
   • Bersihkan debu sisa blasting dan segera aplikasikan primer maksimal 4 jam sebelum timbul karat kilat (flash rust).
2. Substrat Beton (Concrete):
   • Umur beton baru minimal 28 hari sebelum dilapisi cat/epoxy.
   • Kadar air (moisture content) wajib di bawah 4% (uji dengan concrete moisture meter).
   • Bersihkan lapisan semen mati (laitance), debu, dan kontaminan dengan mechanical grinding atau acid etching sampai pori terbuka (profil CSP 2–3).`,
        tips: 'Jangan pernah mengecat di atas permukaan yang berminyak, lembap, atau berkarat lepas. Cat terbaik sekalipun akan mengelupas jika persiapan permukaan tidak sesuai standar.'
      },
      {
        judul: '2. Pemeriksaan Cuaca & Aturan Titik Embun (Dew Point)',
        isi: `Kondisi lingkungan harus memenuhi syarat keselamatan aplikasi:
1. Aturan Wajib 3°C Titik Embun (Dew Point Rule):
   • Suhu permukaan media (baja/beton) WAJIB minimal 3°C DI ATAS titik embun (Dew Point).
   • Contoh: Jika titik embun 24°C, maka suhu baja minimal 27°C.
   • Jika selisih suhu < 3°C, kelembaban udara akan mengembun tipis tak kasat mata di permukaan baja dan menyebabkan cat melepuh (blistering).
2. Kelembaban Relatif Udara (RH):
   • Maksimal 85% RH. Jika RH > 85% atau sedang hujan/kabut, STOP seluruh pekerjaan pengecatan luar ruangan.
3. Rentang Suhu Kerja:
   • Suhu ideal aplikasi adalah 15°C – 35°C.
   • Hindari mengecat di bawah terik matahari ekstrem (> 45°C) karena pelarut akan menguap terlalu cepat dan memicu gelembung udara (solvent popping).`,
        tips: 'Gunakan hygrometer digital atau sling psychrometer untuk mencatat suhu dan RH di laporan harian sebelum memulai pekerjaan coating.'
      },
      {
        judul: '3. Pencampuran (Mixing) & Thinner Sistem 2-Komponen (2K)',
        isi: `Untuk cat 2-Komponen (Epoxy & Polyurethane), ikuti disiplin pencampuran:
1. Homogenisasi Part A (Base):
   • Aduk Part A secara terpisah selama 2–3 menit dengan mixer bor berkecepatan rendah (300–400 rpm) sampai endapan pigmen larut merata.
2. Penambahan Part B (Hardener):
   • Tuang Part B sesuai rasio perbandingan resmi (lihat rasio di menu Produk /produk atau kemasan).
   • Aduk merata secara mekanik selama 3–5 menit hingga warna dan viskositas benar-benar homogen.
3. Waktu Induksi (Induction Time):
   • Diamkan campuran selama 10–15 menit sebelum diaplikasikan agar reaksi awal pengikatan polimer stabil.
4. Thinner yang Tepat:
   • WAJIB gunakan Foxathinner resmi yang sesuai jenis resin:
     - Foxathinner 100: Khusus cat Epoxy
     - Foxathinner 300: Khusus cat Polyurethane (PU)
     - Foxathinner 200: Khusus cat Acrylic
     - Foxathinner 50: Khusus cat Alkyd / Enamel
   • Takaran pengenceran: Maksimal 5%–10% untuk Airless Spray, atau 10%–15% untuk kuas/roller. DILARANG menggunakan thinner bensin/solar/thinner abal-abal.`,
        tips: 'Jangan pernah mengubah rasio Base dan Hardener. Mengurangi hardener tidak membuat cat lambat kering, melainkan membuat cat gagal matang dan lengket selamanya.'
      },
      {
        judul: '4. Batas Waktu Aplikasi (Pot Life) & Ketebalan Film (WFT/DFT)',
        isi: `Pengendalian cat basah dan ketebalan lapisan kering:
1. Batas Pot Life (Masa Pakai Adukan):
   • Setelah Base dan Hardener disatukan, campuran cat akan mulai mengental dan mengeras karena reaksi kimia.
   • Masa pakai adukan umumnya 1,5 – 2 jam pada suhu 30°C.
   • Buat adukan hanya sesuai volume yang sanggup diaplikasikan dalam 1 jam kerja.
   • CAT YANG SUDAH MENGERAS/MENGENTAL DILARANG DIENCERKAN KEMBALI DENGAN THINNER!
2. Kontrol Ketebalan Basah (WFT - Wet Film Thickness):
   • Ukur ketebalan cat basah secara berkala menggunakan sisir WFT gauge.
   • Rumus perkiraan: Target WFT = (Target DFT ÷ % Solid Volume) × (1 + % Thinner).
3. Kontrol Ketebalan Kering (DFT - Dry Film Thickness):
   • Ukur ketebalan akhir setelah kering sempurna dengan alat ukur magnetik (Elcometer) sesuai kaidah 80-20 (SSPC-PA 2).`,
        tips: 'Hindari mengaplikasikan cat terlalu tebal dalam satu sapuan (heavy coat) untuk mengejar ketebalan. Aplikasikan 2 lapis silang (cross-pass) tipis dan merata.'
      },
      {
        judul: '5. Jeda Antar-Lapisan (Overcoating Interval)',
        isi: `Waktu pelapisan ulang antara lapisan primer, intermediate, dan topcoat:
1. Waktu Minimal Pelapisan Ulang (Min Overcoat):
   • Tunggu lapisan sebelumnya kering sentuh dan kering keras (umumnya 4–8 jam untuk Epoxy, 6 jam untuk PU).
   • Mengaplikasikan lapisan baru saat lapisan bawah masih basah akan memicu kerut (wrinkling) atau pelarut terperangkap.
2. Batas Maksimal Pelapisan Ulang (Max Overcoat Window):
   • Lapisan berikutnya harus diaplikasikan sebelum batas waktu maksimum terlampaui (umumnya 48–72 jam).
   • JIKA MELEWATI BATAS MAKSIMAL (Overcured): Lapisan cat telah mengeras licin sempurna. Permukaan WAJIB di-sanding/diamplas secara mekanik (grit 120–180) untuk membuka pori mekanis sebelum dilapisi cat berikutnya.
3. Kebersihan Antar Lapisan:
   • Pastikan permukaan bebas dari debu, kotoran, atau noda minyak sebelum mengaplikasikan lapisan atas.`,
        tips: 'Jika proyek terhenti beberapa hari dan batas max overcoat terlewat, jangan langsung ditimpa cat baru. Lakukan light sanding dan lap bersih dengan solvent sebelum pelapisan lanjut.'
      },
      {
        judul: '6. Matriks Troubleshooting Masalah Cat Lapangan',
        isi: `Solusi cepat jika menemui kendala hasil pengecatan di lapangan:
1. Cat Mengelupas / Lepas Antar-Lapisan (Peeling / Delamination):
   • Penyebab: Kontaminasi minyak/debu pada permukaan, atau overcoating window terlewat tanpa diamplas.
   • Tindakan: Kerok lapisan cat yang terkelupas sampai batas cat sehat, amplas permukaan, bersihkan dengan solvent, dan lapisi ulang.
2. Cat Menggelembung (Blistering):
   • Penyebab: Pengecatan saat substrat basah / di bawah titik embun, atau adanya air/minyak yang lolos dari kompresor spray.
   • Tindakan: Kupas lepuhan, pastikan substrat kering dan pasang filter air/oli pada kompresor, lalu aplikasikan ulang.
3. Permukaan Seperti Kulit Jeruk (Orange Peel):
   • Penyebab: Cat terlalu kental (kurang thinner), tekanan semprot terlalu rendah, atau jarak spray gun terlalu dekat/jauh.
   • Tindakan: Tambah sedikit thinner resmi sesuai rekomendasi dan sesuaikan setelan nozzle spray gun.
4. Lubang Jarum (Pinholes / Popping):
   • Penyebab: Pelarut menguap terlalu cepat akibat terik panas, atau udara terjebak saat mixing terlalu kencang.
   • Tindakan: Hindari pengecatan di bawah terik langsung, turunkan kecepatan mixer, dan amplas halus sebelum ditimpa topcoat.
5. Cat Tidak Kering / Tetap Lengket (Tacky Finish):
   • Penyebab: Rasio Hardener salah (kurang/lebih) atau salah menggunakan thinner abal-abal.
   • Tindakan: Jika setelah 48 jam tetap lunak, lapisan harus dikupas bersih menggunakan paint remover / scraper karena cat tidak akan pernah matang.`,
        tips: 'Bila ragu mengenai kendala aplikasi di lokasi, ambil foto kondisi cat dan laporkan melalui menu R&D Lapangan (/rnd > Tab Lapor Masalah).'
      }
    ],
    faq: [
      {
        tanya: 'Bagaimana jika hujan turun mendadak saat sedang mengecat di luar ruangan?',
        jawab: 'Segera hentikan pekerjaan dan pasang penutup terpal untuk melindungi area yang baru dicat. Setelah cuaca kering, periksa film cat. Jika cat basah rusak terkena tetesan air hujan, tunggu kering penuh lalu amplas dan lapisi ulang.'
      },
      {
        tanya: 'Bolehkah memakai thinner merk lain di lapangan jika Foxathinner habis?',
        jawab: 'Sangat DILARANG. Thinner generik toko bangunan umumnya mengandung alkohol atau pelarut daur ulang yang merusak ikatan resin Epoxy dan PU, menyebabkan cat tidak kering, melepuh, atau hilang kilap.'
      },
      {
        tanya: 'Mengapa cat 2K yang sudah mulai kental di ember tidak boleh ditambah thinner lagi?',
        jawab: 'Karena reaksi kimia pengerasan (polimerisasi) sudah dimulai. Mengencerkan cat yang sudah lewat masa pot life hanya akan merusak struktur molekul dan membuat lapisan cat rapuh, tidak tahan bentur, dan cepat rusak.'
      },
      {
        tanya: 'Di mana saya bisa menghitung takaran campuran Base dan Hardener yang pas untuk jumlah liter yang saya butuhkan?',
        jawab: 'Buka menu Produk (/produk) di aplikasi ini, pilih tab "Kalkulator Campur", lalu masukkan target liter atau kg yang ingin diaduk. Sistem akan otomatis menghitung berat Part A dan Part B yang presisi.'
      }
    ]
  }
];

export function searchModul(keyword: string): ModulPanduan[] {
  if (!keyword) return [];
  const lowerKw = keyword.toLowerCase();
  return modulDokumentasi.filter((m) => 
    m.nama.toLowerCase().includes(lowerKw) ||
    m.deskripsi.toLowerCase().includes(lowerKw) ||
    m.langkah.some(l => l.judul.toLowerCase().includes(lowerKw) || l.isi.toLowerCase().includes(lowerKw))
  );
}

export function getModulById(id: string): ModulPanduan | undefined {
  return modulDokumentasi.find((m) => m.id === id);
}

/**
 * Cari modul panduan yang paling cocok dengan path URL saat ini, dengan
 * mencocokkan awalan `href` modul terpanjang yang match. Dipakai
 * HelpMenuButton untuk tombol "?" kontekstual — §7B #2 (implementation_plan_
 * panduan + video generator.md), port dari resolveModulByPathname erp-epi-1.
 */
export function resolveModulByPathname(pathname: string): ModulPanduan | null {
  if (!pathname) return null;
  let terbaik: ModulPanduan | null = null;
  for (const m of modulDokumentasi) {
    if (!m.href) continue;
    if (pathname === m.href || pathname.startsWith(m.href + '/')) {
      if (!terbaik || m.href.length > terbaik.href.length) terbaik = m;
    }
  }
  return terbaik;
}
