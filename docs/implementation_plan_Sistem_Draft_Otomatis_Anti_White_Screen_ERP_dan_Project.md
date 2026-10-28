# Rencana Implementasi: Sistem Draf Otomatis & Anti-White Screen Universal (ERP Admin & Project Lapangan)

Dokumen ini memuat analisa infrastruktur, arsitektur teknis sistem draf lokal tahan crash (*anti-white screen*), rekomendasi fitur lanjutan untuk dashboard admin dan lapangan, serta rencana kerja bertahap.

## User Review Required

> [!IMPORTANT]
> **Arsitektur Auto-Save Lokal vs API Server**:
> Untuk menghindari lonjakan trafik (*traffic flood*), pemborosan kuota API, dan risiko database locking di Directus / webhook n8n, mekanisme auto-save saat pengetikan dilakukan secara **lokal di sisi klien** (menggunakan IndexedDB untuk payload besar/foto dan localStorage untuk data teks/JSON) dengan debounce 600–800ms.
> Pengiriman data ke server / Directus / n8n hanya dilakukan saat:
> 1. User menekan tombol "Submit" final.
> 2. (Opsional) User secara eksplisit menekan "Simpan Draf ke Server".

> [!WARNING]
> **Ketiadaan Error Boundary di Lapangan**:
> Saat ini `project-epi` (dashboard lapangan) belum memiliki file `src/routes/+error.svelte`. Jika terjadi uncaught exception pada render komponen, browser akan langsung menampilkan white screen total. Penambahan `+error.svelte` dan Crash Shield menjadi prioritas fondasi (Fase 0).

---

## 1. Hasil Audit Infrastruktur & Konektivitas

1. **Directus (`directus.eltamaprimaindo.com`)**:
   - Berfungsi sebagai backend database. Token rahasia berada di environment server.
   - Sesuai aturan: pemanggilan relasi wajib dipisah per relasi (*separated for each relation*) dan diberi pengecekan null yang ketat (`?.`).
2. **SvelteKit 2 & Svelte 5**:
   - `erp-epi` (Admin internal): SvelteKit 2 + Svelte 5 (mode kompatibilitas & runes).
   - `project-epi` (Lapangan): SvelteKit 2 + Svelte 5 (full runes: `$state`, `$derived`, `$effect`).
   - Port runtime default: `9391`.
3. **n8n (`https://n8n.internal.eltamaprimaindo.com`)**:
   - Status koneksi: **Terhubung & OK** (`{"status": "ok"}` pada `/healthz`).
   - Terintegrasi untuk alur kerja otomatis (alert deviasi GR, generator dokumen PDF, bot notifikasi, dll.).

---

## 2. Analisa Masalah White Screen & Kehilangan Data Input

### Akar Masalah:
1. **Uncaught Error pada Svelte Reaktif / Render**: Ketika properti objek relasional bernilai `null`/`undefined` sesaat sebelum query Directus selesai, JavaScript melemparkan `TypeError`. Tanpa error boundary, Svelte meng-unmount seluruh komponen halaman sehingga terjadi *white screen*.
2. **Penyusutan Memori (*Tab Discarding*) pada Mobile Lapangan**: Kamera smartphone resolusi tinggi menghasilkan foto ukuran 8–15MB. Saat user mengunggah beberapa foto di form lapangan, memori RAM HP habis dan browser mobile me-reload tab secara otomatis, melenyapkan seluruh inputan.
3. **Penyimpanan State Hanya di Memori**: Form-form saat ini menyimpan data di variabel lokal komponen Svelte (`let` atau `$state`). Jika terjadi reload, white screen, atau session refresh, data hilang 100%.

### Solusi Anti-White Screen:
- **Crash Shield Boundary**: Menangkap error tak terduga sebelum merusak halaman dan menyediakan tombol satu-klik untuk memuat ulang sambil memulihkan draf form secara instan.
- **Background Auto-Save Engine**: Menyimpan setiap perubahan input secara lokal tanpa membebani server dan jaringan.
- **Emergency Flusher**: Menyimpan snapshot formulir saat event darurat browser (`visibilitychange`, `pagehide`, `beforeunload`, dan `window.onerror`).

---

## 3. Desain Arsitektur Sistem Draf

### A. Engine Inti: `formDraftEngine`
Dibuat di kedua project:
- `C:\dev\erp-epi\src\lib\services\formDraftEngine.js`
- `C:\dev\project-epi\src\lib\services\formDraftEngine.ts`

**Spesifikasi Teknis:**
- **Penyimpanan Primer**: IndexedDB (`idb`) untuk kapasitas besar, file blob, dan foto.
- **Penyimpanan Sekunder**: `localStorage` sebagai fallback instan jika IndexedDB terkunci atau tidak didukung.
- **Skema Kunci Unik**:
  `draft:{app}:{userId}:{formModule}:{recordId || 'new'}`
  *Mencegah tertukarnya draf antar-pengguna pada perangkat atau Kiosk bersama.*
- **Fitur Utama**:
  - `saveDraft(key, data, meta)`: Auto-save debounced (600–800ms).
  - `loadDraft(key)`: Mengambil draf dan memverifikasi batas kedaluwarsa (TTL 7 hari).
  - `clearDraft(key)`: Menghapus draf saat form berhasil di-submit.
  - `listDrafts()`: Mendaftar semua draf aktif untuk ditampilkan di panel kendali user.
  - `exportDraftAsJson(key)` / `importDraftFromJson()`: Fitur backup darurat file JSON.

### B. Komponen Antarmuka Pengguna (UI)
1. **`<FormDraftBar />` / `<DraftIndicator />`**:
   - Terpasang rapi di bagian atas form atau header modal.
   - **Banner Draf Ditemukan**:
     *"Ditemukan draf isian yang belum terkirim dari 12 menit yang lalu (10:35 WIB). Apakah ingin memulihkan isian tersebut?"*
     Tombol: `[ Pulihkan Isian ]` & `[ Abaikan / Hapus Draf ]`.
   - **Status Realtime**:
     *"✓ Draf tersimpan otomatis (10:48 WIB)"* (Ikon centang hijau).
     *"Offline — Draf aman tersimpan di perangkat"* (Saat sinyal hilang).
2. **`<CrashShield />` & Pemulihan White Screen**:
   - Menggantikan layar putih mati dengan kartu pemulihan cerdas:
     *"Terjadi kendala visual pada halaman, namun seluruh isian Anda tersimpan aman di draf perangkat."*
     Tombol: `[ Muat Ulang & Pulihkan Form ]` dan `[ Salin Isian ke Clipboard ]`.
3. **Pusat Draf Tersimpan (Drawer Pengguna)**:
   - Akses melalui profil/pengaturan untuk melihat dan mengelola seluruh draf lokal yang tersimpan.

---

## 4. Pemetaan Form yang Dicakup

### Dashboard Admin (`erp-epi`):
1. **Pengadaan & Anggaran**: `AjukanAnggaranModal.svelte` (Pengajuan Anggaran Operasional, Vendor, Project, Petty Cash), `RevisiPengajuanModal.svelte`, `OverrideRequestModal.svelte`.
2. **Project Management**: Form Pembuatan Proyek Baru, Edit Detail Proyek, Rincian Item Anggaran (RAB/RAP), Timeline Proyek, dan Spek Teknis (`src/routes/project/`).
3. **Produksi & Pabrik**: Form Work Order / SPK (`src/routes/production/work-order/`), Laporan Harian Produksi & Rework Log (`src/routes/production/daily/`, `rework`), QC Inspeksi (`src/routes/production/qc/`).
4. **Logistik & Gudang**: Form Surat Jalan Manual (`src/routes/inventory/sj-manual/`, `surat-jalan`), Mutasi Barang, Penerimaan Barang, Stock Opname.
5. **Sales & Marketing**: Form Sales Quotation (`src/routes/sales-quotation/`), Kalkulator Penawaran, Form Survey & Visit (`src/routes/sales/survey/`, `visit/`).
6. **Maintenance & GA**: Form Log Perbaikan Mesin (`src/routes/maintenance/perbaikan/`), Jadwal Preventive, Pengajuan Fasilitas GA, Checklist Gedung.
7. **ESS & HR**: Form Pengajuan Cuti, Izin Sakit, Kasbon Karyawan, Klaim Reimburse, Lembur (`src/routes/ess/`).

### Dashboard Lapangan (`project-epi`):
1. **Laporan Harian Proyek**: `src/routes/(app)/laporan/[project_id]/+page.svelte` (Integrasi draf foto & delta material ke standard universal engine).
2. **Kiosk Produksi & Lapangan**: Form Kiosk Input Produksi (`src/routes/kiosk/input-produksi/`), Lapor Rusak Mesin (`src/routes/kiosk/lapor-mesin/`), QC Lapangan (`src/routes/kiosk/qc/`).
3. **Pusat Pengajuan Lapangan**: Form Pengajuan Operasional Site & Kasbon Mandiri (`src/routes/(app)/pusat-pengajuan/`).
4. **HSE, K3 & Inspeksi**: Form Job Safety Analysis (JSA), Form K3/HSE, Checklist Equipment & P2H (`src/routes/(app)/jsa/`, `hse/`, `inspection/`).
5. **Material & Requisition Lapangan**: Form Permintaan Material Tambahan (`src/routes/(app)/requisition/`), Retur Material (`src/routes/(app)/stock-lapangan/`).

---

## 5. Rekomendasi Fitur Unggulan (Admin & Lapangan)

### A. Dashboard Lapangan (`project-epi`):
1. **WebWorker Background Photo Compression**:
   - Mengompresi foto kamera 50MP (10MB+) menjadi ~800KB di background WebWorker sebelum masuk memori DOM/IndexedDB. Menghilangkan 90% penyebab crash browser mobile pada perangkat mekanik.
2. **Fitur Dikte Suara (Voice-to-Text) untuk Mekanik**:
   - Tombol mikrofon di kolom kendala menggunakan Web Speech API bawaan browser (tanpa biaya API). Mekanik yang bertangan kotor/menggunakan sarung tangan cukup mendiktekan laporannya.
3. **Offline Sync Queue Status Floating Pill**:
   - Indikator status mengambang di pojok layar yang memperlihatkan berapa antrean form yang siap di-submit saat kembali mendapatkan koneksi internet.

### B. Dashboard Admin (`erp-epi`):
1. **Abandoned Draft Tracker & Alert SLA**:
   - Panel pengawasan manajer untuk mendeteksi jika ada pengajuan anggaran darurat proyek atau revisi SPK yang terbengkalai di status draf lebih dari 24 jam.
2. **Pendeteksi Tab Ganda (Multi-Tab Collision Guard)**:
   - Memakai `BroadcastChannel API` untuk memberi peringatan jika formulir yang sama (misal Proyek ID #50) dibuka di 2 tab browser secara bersamaan, mencegah data tertimpa.
3. **Directus Safe-Relation Access Wrapper**:
   - Utility fungsi `safeRel(obj, 'relation.field', '-')` untuk membasmi potensi TypeError saat relasi database bernilai null.
4. **Otomasi Ringkasan Harian Laporan Lapangan via n8n**:
   - n8n mengompilasi laporan harian yang masuk setiap pukul 18.00 WIB menjadi ringkasan eksekutif via PDF/WhatsApp untuk manajemen.

---

## 6. Rencana Eksekusi Bertahap (Phased Rollout) & Pertanyaan Kunci

Setiap fase dirancang bertahap untuk meminimalkan bug dan menjaga stabilitas sistem di branch `Major`:

### Fase 0: Fondasi Engine Draf & Anti-White Screen Shield
- Implementasi `formDraftEngine` di `erp-epi` dan `project-epi`.
- Pembuatan `src/routes/+error.svelte` di `project-epi` dan penguatan penanganan crash di `erp-epi`.
- Pengikatan event darurat (`visibilitychange`, `pagehide`, `beforeunload`, dan `window.onerror`).
- **Pertanyaan Kunci Fase 0**:
  > *Apakah masa retensi draf lokal disetujui selama 7 hari sebelum otomatis dibersihkan (untuk mencegah memori browser penuh), atau Anda menginginkan batas waktu lain (misal 3 hari atau 14 hari)?*

### Fase 1: Standarisasi Komponen UI & Antarmuka Pemulihan Draf
- Pembuatan komponen `<FormDraftBar.svelte>` dan `<DraftIndicator.svelte>` lengkap dengan hint dan panduan operasional.
- Banner konfirmasi pemulihan draf saat form dibuka.
- Pembuatan drawer sederhana *"Pusat Draf Tersimpan"* di profil user.
- **Pertanyaan Kunci Fase 1**:
  > *Saat pengguna membuka form yang memiliki draf tersimpan, apakah sistem sebaiknya **menampilkan banner konfirmasi** (pengguna memilih "Pulihkan" atau "Abaikan") atau **langsung me-restore otomatis** dengan notifikasi toast? (Rekomendasi kami: Banner konfirmasi agar data dari server terbaru tidak tertimpa tanpa sengaja).*

### Fase 2: Implementasi Modul Prioritas Tinggi (Pengajuan Anggaran & Laporan Harian)
- Integrasi draf ke `AjukanAnggaranModal.svelte` di `erp-epi`.
- Integrasi dan standarisasi ke `src/routes/(app)/laporan/[project_id]/+page.svelte` di `project-epi`.
- Uji simulasi crash (refresh paksa di tengah pengetikan).
- **Pertanyaan Kunci Fase 2**:
  > *Untuk form Pengajuan Anggaran, apakah lampiran file kuitansi/nota juga wajib disimpan ke dalam draf offline perangkat, atau cukup data teks & rincian nominalnya saja untuk menghemat ruang penyimpanan browser?*

### Fase 3: Rollout Form Lapangan & Kiosk (`project-epi`)
- Form Kiosk Produksi (Input Hasil, Lapor Mesin, QC).
- Form Pusat Pengajuan Dana & Kasbon Lapangan.
- Form HSE / K3, JSA, dan Inspeksi Alat/Equipment.
- Form Requisition Material & Retur Gudang.
- **Pertanyaan Kunci Fase 3**:
  > *Pada tablet Kiosk yang digunakan bergantian oleh banyak operator/pekerja, apakah draf harus otomatis dibersihkan saat sesi logout/ganti nama operator, atau tetap disimpan berdasarkan nomor SPK/Shift?*

### Fase 4: Rollout Seluruh Form Admin (`erp-epi`)
- Form Project Management (RAB, Timeline, Spek Teknis).
- Form Work Order & Daily Production Admin.
- Form Surat Jalan Manual & Mutasi Gudang.
- Form Sales Quotation & Kalkulator Penawaran.
- Form Maintenance, GA, dan ESS (Cuti, Kasbon, Lembur).
- Verifikasi akhir branch `Major` sebelum penggabungan.
- **Pertanyaan Kunci Fase 4**:
  > *Apakah Anda ingin opsi "Ekspor Draf ke File JSON" sebagai tombol cadangan darurat ekstra bagi admin jika perangkat hendak di-reset atau ganti laptop?*

---

## 7. Panduan Operasional & Hint untuk Pengguna

| Situasi | Tampilan UI | Tindakan Pengguna |
| :--- | :--- | :--- |
| **Mengetik form baru** | Ikon bulat hijau: *"Draf tersimpan otomatis pk 10:45"* | Pengguna dapat melanjutkan pengetikan dengan tenang; data diamankan di background setiap ketukan berhenti. |
| **White screen / Refresh tak sengaja** | Halaman pulih menampilkan banner: *"Ditemukan draf dari 5 menit lalu"* | Klik tombol **[Pulihkan Isian]**; seluruh isian teks, nominal, dan pilihan akan kembali seketika. |
| **Form berhasil dikirim (Submit)** | Toast: *"Data berhasil dikirim"* | Sistem otomatis menghapus draf lokal form tersebut agar tidak mengganggu pengisian berikutnya. |
| **Tidak ada koneksi internet (Offline)** | Ikon oranye: *"Offline — Draf aman di perangkat"* | Pengguna tetap dapat melengkapi form hingga selesai, lalu klik submit saat sinyal kembali. |
