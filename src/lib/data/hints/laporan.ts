import type { HintModule } from './getHint';

// Konten diverifikasi ulang terhadap form nyata di
// src/routes/(app)/laporan/[project_id]/+page.svelte dan daftar di
// src/routes/(app)/laporan/+page.svelte (12 Agustus 2026). Beberapa teks lama
// menjelaskan field yang tidak ada / aturan yang tidak berlaku — sudah dikoreksi.

export const laporanHints: HintModule = {
  // Fase 3 (Loop Perbaikan, Gate Keras Disiplin Data & Laporan Harian, 17 Sep 2026).
  'laporan.perlu_diperbaiki.page': {
    fieldHint: 'Laporan yang admin minta diperbaiki (Perlu Revisi) atau tolak (Ditolak, final).',
    helpIcon: 'Selama masih ada tunggakan revisi, pengajuan anggaran baru Anda bisa tertahan di gerbang kepatuhan laporan. Tekan "Perbaiki Sekarang" — form akan langsung terbuka di bagian yang kurang.'
  },
  'laporan.page': {
    sectionGuide: {
      title: 'Panduan: Laporan Harian Proyek',
      steps: [
        'Pilih proyek yang akan dilaporkan dari daftar proyek aktif Anda',
        'Tentukan Status Aktivitas: On Progress, atau Hold bila hari ini tidak ada pekerjaan',
        'Isi metadata wajib: cuaca, jumlah tenaga, kendala, catatan umum, dan rencana besok',
        'Catat nilai progress tiap pekerjaan dalam satuannya (mis. m²), bukan persen',
        'Unggah Foto Bukti Progress — wajib, laporan tidak bisa dikirim tanpa foto',
        'Kirim laporan untuk ditinjau Project Manager (Terkirim → Disetujui / Ditolak)'
      ]
    }
  },
  // Terpasang di halaman daftar (/laporan), bukan di form — di form, field Proyek
  // readonly karena proyek sudah ditentukan oleh rute /laporan/[project_id].
  'laporan.form.proyek': {
    fieldHint: 'Pilih proyek yang Anda tangani hari ini. Hanya proyek aktif yang ditampilkan.'
    // helpIcon dihapus: halaman daftar sudah punya banner "Perhatian" permanen yang
    // menyampaikan pesan sama (hubungi Admin bila proyek tak muncul / bukan milik Anda).
  },
  // Field nyata: "Nilai Progress Hari Ini" per pekerjaan, dalam satuan pekerjaan itu
  // (m², kg, dst. — satuannya readonly, ikut data timeline). Bukan persentase kumulatif;
  // persentase keseluruhan dihitung sistem lewat calculateProjectProgressPercentage()
  // (per-subtask, unit-aware — lihat $lib/utils/projectProgress.ts).
  'laporan.form.progress': {
    fieldHint: 'Isi volume yang selesai HARI INI saja, dalam satuan pekerjaan (mis. m²) — bukan persen dan bukan angka kumulatif.',
    helpIcon: 'Persentase keseluruhan proyek dihitung otomatis oleh sistem dari akumulasi nilai harian terhadap target volume.',
    type: 'info'
  },
  'laporan.form.cuaca': {
    fieldHint: 'Kondisi cuaca mempengaruhi justifikasi keterlambatan pekerjaan outdoor.'
  },
  'laporan.form.manpower': {
    fieldHint: 'Jumlah pekerja yang hadir di lapangan hari ini.',
    helpIcon: 'Termasuk subkontraktor. Akan dibandingkan dengan rencana manpower di RAP.'
  },
  // Sistem hanya mewajibkan minimal 1 foto (dicek saat submit). Orientasi & ukuran file
  // TIDAK divalidasi kode — disebut sebagai anjuran, bukan aturan sistem, supaya user
  // tidak mengira unggahannya akan ditolak.
  'laporan.form.foto': {
    fieldHint: 'Wajib minimal 1 foto — laporan tidak bisa dikirim tanpa Foto Bukti Progress.',
    type: 'warning',
    helpIcon:
      'Foto harus menunjukkan progress pekerjaan aktual; hindari blur atau backlight.\nDianjurkan orientasi landscape agar area kerja terlihat luas.\nFoto otomatis diberi tag lokasi GPS bila izin lokasi aktif.'
  },
  // Field "Kendala (umum)" bertanda * — WAJIB, bukan opsional.
  'laporan.form.kendala': {
    fieldHint: 'Wajib diisi. Bila hari ini tidak ada kendala, tulis "Nihil" — jangan dikosongkan.',
    helpIcon: 'Kendala yang dicatat di sini muncul di laporan mingguan untuk perhatian manajemen.'
  },
  'laporan.form.material': {
    fieldHint: 'Catat kebutuhan material mendesak. Otomatis masuk antrian permintaan material.',
    helpIcon: 'Untuk permintaan formal, gunakan menu Procurement → Ajukan.'
  },
  // Fase 1 Laporan Lapangan & Paritas ERP (16 Okt 2026) — tab HSE & K3.
  'laporan.form.hse_apd': {
    fieldHint: 'Nilai kepatuhan pemakaian APD (helm, sepatu safety, rompi, dll) di lokasi kerja hari ini.',
    helpIcon: 'Status TBM, PTW aktif, dan insiden terbuka di atas diambil otomatis dari modul Toolbox Meeting & HSE — tidak perlu diisi ulang di sini.'
  },
  'laporan.form.hse_catatan': {
    fieldHint: 'Opsional — catat temuan K3 lapangan hari ini (near-miss, kondisi tidak aman, dll) bila ada.'
  },
  'laporan.form.downtime': {
    fieldHint: 'Wajib diisi bila cuaca tidak Cerah — catat berapa jam kerja berhenti dan penyebabnya.',
    helpIcon: 'Data ini jadi bukti administrasi untuk klaim Extension of Time (EOT) atau standby cost ke klien. Tidak menghalangi pengiriman laporan.',
    type: 'warning'
  },

  // Status nyata di kode: draft | submitted | approved | rejected | revision_requested
  // (label UI: Draft, Terkirim, Disetujui, Ditolak, Perlu Diperbaiki). Tidak ada status
  // "Reviewed". `revision_requested` ditambah Fase 3 (Loop Perbaikan, 17 Sep 2026, menutup
  // C6) — sebelumnya cuma approve/reject final, tidak ada jalur memperbaiki.
  'laporan.status.draft': {
    explain: 'Laporan masih draft, belum dikirim ke Project Manager. Masih bisa diedit.',
    flow: ['Draft', 'Terkirim', 'Disetujui']
  },
  'laporan.status.submitted': {
    explain: 'Laporan sudah dikirim dan menunggu tinjauan Project Manager. Tidak bisa diedit selama menunggu.',
    flow: ['Draft', 'Terkirim', 'Disetujui']
  },
  'laporan.status.approved': {
    explain: 'Laporan disetujui dan masuk arsip proyek.',
    flow: ['Draft', 'Terkirim', 'Disetujui']
  },
  'laporan.status.rejected': {
    explain: 'Laporan ditolak dan bersifat FINAL — tidak bisa dikirim ulang untuk tanggal yang sama.',
    flow: ['Draft', 'Terkirim', 'Disetujui']
  },
  'laporan.status.revision_requested': {
    explain: 'Admin minta laporan ini diperbaiki sebelum batas waktu. Buka "Perlu Diperbaiki" di halaman Laporan, lengkapi bagian yang diminta, lalu kirim ulang — laporan otomatis kembali menunggu tinjauan.',
    flow: ['Draft', 'Terkirim', 'Perlu Diperbaiki', 'Terkirim Ulang', 'Disetujui']
  },

  // TODO(hint): 3 kunci kolom di bawah belum terpasang — daftar laporan di
  // src/routes/(app)/laporan/+page.svelte memakai kartu, bukan tabel berkolom.
  // Pasang bila nanti ada tampilan tabel.
  'laporan.kolom.tanggal': {
    columnHint: 'Tanggal laporan dibuat. Satu proyek hanya boleh 1 laporan per hari.'
  },
  'laporan.kolom.progress': {
    columnHint: 'Progress kumulatif yang dilaporkan. Dibandingkan dengan target S-Curve.'
  },
  'laporan.kolom.status': {
    columnHint: 'Status tinjauan laporan: Draft → Terkirim → Disetujui (atau Ditolak).'
  },

  'laporan.empty': {
    message: 'Belum ada laporan harian',
    // Tanpa actionLabel/actionHref: aksi berikutnya adalah memilih proyek dari daftar
    // di halaman yang sama, bukan navigasi ke URL lain. '/laporan?action=baru' adalah
    // tautan mati — parameter itu tidak pernah dibaca.
    hints: [
      'Laporan harian wajib diisi setiap hari kerja',
      'Pilih proyek aktif Anda di daftar bawah, lalu isi progress dan unggah foto'
    ]
  }
};
