# PRD — Produksi Field Reporting (Lapangan Pabrik Cat)

> Status: **Draft untuk persetujuan** · Dibuat 2026-07-05 · Bagian: Produksi
> Backend Directus dipakai bersama oleh **project-epi** (lapangan, mobile-first PWA, `:5174`) dan
> **erp-epi-1** (dashboard admin/desktop, `:9391`) — `directus.eltamaprimaindo.com`.
> Dokumen ini melengkapi keluarga modul field reporting yang sudah ada (Preventive, Maintenance,
> Inventory/Stock Lapangan, Sales, Support, Driver, GA Checklist, Satpam).

---

## 1. Ringkasan Eksekutif

PT Eltama Prima Indo memproduksi cat/coating (epoxy, floor coating, dll). Perintah produksi per
batch sudah terekam di koleksi **`spk`** (Surat Perintah Kerja) dan digerakkan penuh oleh aplikasi
desktop `erp-epi-1` melalui siklus tervalidasi: *worksheet dibuat → produksi mulai → produksi selesai
→ QC → finished good masuk gudang*. Namun **eksekusi di lantai produksi masih dilakukan di depan
komputer desktop / kertas**, lalu dientri ulang oleh admin.

Modul **Produksi Field Reporting** memberi operator lantai produksi (dan QC) jalur tulis **dari HP**
untuk: melihat antrian SPK yang ditugaskan, menandai mulai/selesai produksi, mencatat hasil aktual
(jumlah jadi, sisa bahan, bahan rusak), mengisi hasil uji QC, dan melapor rework — semuanya menulis
ke koleksi Directus yang **sama** dengan yang dibaca dashboard admin, tanpa spreadsheet/entri-ulang
perantara.

**Prinsip utama (konsisten dengan modul lain):** lapangan hanya menulis field yang menjadi haknya;
transisi status yang bersifat keputusan admin/QC final tetap milik `:9391`. Tidak ada koleksi baru
yang menggantikan yang lama — kita jadi **klien mobile kedua** atas koleksi produksi yang sudah ada.

---

## 2. Latar Belakang & Masalah

- **Entri ulang.** Operator mengerjakan batch di lantai, mencatat di kertas/worksheet, lalu data
  dientri ulang oleh admin ke `spk` di desktop → jeda waktu, salah ketik, kehilangan bukti.
- **Tidak real-time.** Kepala produksi & PPIC tidak tahu status batch (mulai? selesai? QC?) sampai
  admin meng-update sistem.
- **Bukti tercecer.** Foto packing/kaleng, catatan QC, alasan rework tersimpan di WA/kertas, tidak
  menempel ke record SPK.
- **Sudah ada modelnya.** Berbeda dari kebanyakan modul, model data produksi **sudah kaya dan
  matang** (`spk` punya siklus lengkap + QC embedded). Pekerjaan intinya adalah **UI tulis mobile**
  yang aman atas model itu — bukan membangun model baru.

**Why (untuk memori):** Project Leader ingin menutup celah "entri ulang" yang sama seperti modul
Maintenance/Inventory — operator lapor dari HP, admin produksi baca data yang sama.

---

## 3. Tujuan & Metrik Sukses

| Tujuan | Metrik |
|---|---|
| Hilangkan entri ulang SPK | ≥ 80% batch di-*start*/*complete* dari HP dalam 1 bulan pilot |
| Status batch real-time | Selisih waktu "produksi selesai fisik" → "tercatat di sistem" turun dari jam ke menit |
| Bukti menempel ke SPK | ≥ 90% batch selesai punya foto packing/QC terlampir |
| Tidak merusak alur desktop | 0 regresi pada siklus `spk` yang dipakai `erp-epi-1` |

---

## 4. Persona & Peran

| Persona | Aktivitas di HP |
|---|---|
| **Operator Produksi** | Lihat antrian SPK ditugaskan; tandai *mulai produksi*; catat hasil aktual (jumlah jadi, sisa bahan, bahan rusak); foto packing; tandai *selesai produksi* (kirim ke QC). |
| **QC Produksi** | Isi hasil uji (`periksa_cat`, `cek_panel`, `packaging_qc`), set lulus/tidak, foto/ catatan QC. |
| **Kepala Produksi / SPV** (opsional Fase 4) | Dashboard ringkas: batch aktif, menunggu QC, yield, rework hari ini. |

RBAC memakai pola feature-key yang sudah ada di [`permissions.ts`](../src/lib/constants/permissions.ts).
Feature key baru yang diusulkan (belum diberikan ke role default manapun — dikonfigurasi manual lewat
Admin > Roles, konsisten dengan cara `input_maintenance` ditangani):

- `input_produksi` — Input Eksekusi Produksi (mulai/selesai/hasil)
- `input_qc_produksi` — Input Hasil QC Produksi
- `view_produksi` — Lihat Dashboard Produksi Lapangan (Fase 4)

Usulan role baru: `produksi` (operator lantai) dan `qc` (opsional). Nama operator dipetakan ke
identitas via pola `resolveOperatorId()` yang sudah dipakai modul Preventive/Maintenance (cocokkan
`karyawanName` → entitas personel), karena `spk` memakai `user_created` (Directus user), bukan
`karyawanId`.

---

## 5. Ruang Lingkup

**Masuk (in-scope):**
1. Antrian SPK ("SPK Saya" / batch siap dikerjakan) — read.
2. Mulai produksi (set `production_started`, `status`).
3. Catat hasil produksi aktual + sisa bahan + bahan rusak + foto packing.
4. Selesai produksi → kirim ke QC (set `production_completed`, `actual_quantity_produced`, tandai
   menunggu QC — **tidak** langsung menutup ke gudang).
5. Input hasil QC (`qc_test_results`, `quality_status`, `qc_notes`, `qc_photo_id`).
6. Lapor rework (batch tidak lulus / retur) — Fase 3.
7. Dashboard ringkas produksi lapangan — Fase 4.

**Keluar (non-goals):**
- Pembuatan/penjadwalan SPK & generate worksheet/formula — tetap di desktop `erp-epi-1` (PPIC).
- Perhitungan formula/RMC dan substitusi material — hanya **dibaca**, tidak dihitung di HP.
- Pergerakan finished good ke lokasi rak/gudang final & serah-terima — tetap wewenang admin gudang.
- Costing produksi (`production_costing`), akuntansi, dan PO bahan.
- Keputusan QC final yang mengubah status inventory resmi bila kebijakan menetapkannya milik admin
  (lihat R2).

---

## 6. Model Data (koleksi yang sudah ada — diverifikasi live 2026-07-05)

Koleksi inti = **`spk`**. Satu row = satu batch produksi. Field kunci yang relevan untuk lapangan
(diambil dari data nyata id 765–766):

| Field | Tipe | Peran di alur lapangan |
|---|---|---|
| `nomor` | string (`SPK260703152`) | Nomor SPK — tampilan & pencarian. |
| `batch_no` | string (`0766/072026/SPK2/(DB)`) | Nomor batch. |
| `status` | string (`completed`, dll) | Siklus batch — lihat R2 utk nilai yang boleh ditulis lapangan. |
| `product_id` / `finished_good` | m2o / string | Produk cat yang diproduksi. |
| `nama_formula` / `template_formula_id` | string / int | Formula (read-only di HP). |
| `jumlah_produksi` / `total_kg` / `unit` | string/number | Target produksi. |
| `so_reference` / `customer_id` | int | Sales order & customer terkait. |
| `production_started` | timestamp | **Diisi saat operator tekan "Mulai Produksi".** |
| `production_completed` | timestamp | **Diisi saat operator tekan "Selesai".** |
| `actual_quantity_produced` | number | **Hasil aktual — input operator.** |
| `quality_status` | string (`passed`/…) | **Diisi QC.** |
| `qc_test_results` | json | **QC:** `{ periksa_cat:{viscosity_supply,sc_solid_content,sg_specific_gravity,thinning_ratio,pot_life,delta_e}, cek_panel:{air_drying,adhesi_cross_cut,gloss,thickness,hiding_power,roughness}, packaging_qc:{kondisi_kaleng,kesesuaian_label,kebersihan} }` |
| `qc_notes` / `qc_photo_id` / `qc_started_date` / `qc_test_completed_date` | text/uuid/timestamp | Metadata QC. |
| `has_rework` / `total_rework_quantity` / `rework_count` / `final_yield_percentage` | flags/number | Rework & yield (Fase 3). |
| `finished_goods_status` | string (`IN_INVENTORY`) | Status FG — **milik admin gudang**, tidak ditulis lapangan (lihat R2). |

Koleksi pendukung:
- **`hasil_produksi`** (legacy sederhana: `nomor_spk`, `finished_good`, `nama_formula`, `jumlah_jadi`,
  `sisa_bahan`, `bahan_rusak`, `catatan_produksi`). **R3:** perlu diklarifikasi apakah masih dipakai
  admin atau sudah digantikan field di `spk`. Modul Stock Lapangan yang ada saat ini mencatat "Hasil
  Produksi" sebagai `stock_transactions` (`category_transaction = PRODUCTION_OUTPUT`), lihat
  [`stockLapangan.ts`](../src/lib/services/stockLapangan.ts) — jangan sampai terjadi **pencatatan
  ganda** dengan alur SPK ini.
- **`production_rework`** & **`rework_material_consumption`** (kosong saat ini) — target Fase 3, konfirmasi skema ke admin dulu.
- **`daily_monitoring_screw`** / **`daily_monitoring_piston`** (kosong saat ini) — monitoring mesin harian, **opsional** (Fase 4+), butuh konfirmasi field.
- **`produk_cat`**, `kode_fg`, `warna_fg`, `finishgood` — master produk/warna FG (read-only untuk picker).

> **Catatan penting (pola string→angka):** seperti di modul Inventory, beberapa field numerik di
> Directus bertipe **string** (mis. `jumlah_produksi`, `jumlah_jadi`). Selalu `parseFloat` sebelum
> operasi matematis. Ikuti pola `writeStockMovement` di `stockLapangan.ts`.

---

## 7. Alur End-to-End (target)

1. Operator buka `/produksi` → daftar SPK yang **siap dikerjakan** (mis. `status` antrian, worksheet
   sudah di-generate `worksheet_generated_date != null`, belum `production_completed`).
2. Buka `/produksi/[id]` → lihat detail batch (produk, formula read-only, target kg, customer/SO) →
   tekan **"Mulai Produksi"** → PATCH `production_started`, `status` (nilai per R2).
3. Selama/akhir produksi: isi **hasil aktual** (`actual_quantity_produced`), sisa bahan, bahan rusak,
   catatan; unggah **foto packing** (kompres sebelum upload — jaringan pabrik) → tekan
   **"Selesai Produksi (Kirim ke QC)"** → PATCH `production_completed` + tandai menunggu QC.
   Lapangan **tidak** men-set `finished_goods_status`.
4. QC buka batch menunggu QC → isi `qc_test_results` (form periksa_cat / cek_panel / packaging_qc),
   `quality_status`, `qc_notes`, foto → submit → PATCH.
5. Bila **tidak lulus** → alur **rework** (Fase 3): catat alasan, `has_rework`, `rework_*`.
6. Admin/gudang di `:9391` melakukan langkah final (masuk gudang, lokasi rak, serah-terima) seperti
   biasa — **tidak diubah** oleh modul ini.

Setiap submit menulis **audit log** (pola `logActivity()` yang dipakai modul lain).

---

## 8. Rencana Fase

- **Fase 0 — Fondasi & keselarasan (wajib sebelum tulis apa pun).**
  Sepakati dengan tim `:9391`: R1 (auth/token tulis dari project-epi ke koleksi produksi), R2 (nilai
  `status` mana yang boleh ditulis lapangan vs milik admin), R3 (hasil_produksi vs spk vs
  stock_transactions — hindari double-count). Buat `src/lib/services/produksi.ts` (pola `directus.request`
  + `handleDirectusError`, interface TS per entitas). Tambah feature key `input_produksi` /
  `input_qc_produksi` / `view_produksi` di `permissions.ts` (tanpa role default). `resolveOperatorId()`.

- **Fase 1 — "SPK Saya" read-only.** Rute `(app)/produksi/+page.svelte` (antrian) + `[id]/+page.svelte`
  (detail batch, formula read-only). Tidak ada tulis → aman, memberi nilai visibilitas lebih dulu.

- **Fase 2 — Eksekusi produksi (rilis berguna pertama).** Tombol Mulai/Selesai + form hasil aktual +
  foto packing. PATCH `production_started`/`production_completed`/`actual_quantity_produced`. Ini
  rilis end-to-end nyata pertama.

- **Fase 3 — QC & Rework.** Form QC (`qc_test_results` dst), alur rework (`production_rework`/field
  rework di `spk`) — **hanya** setelah skema rework dikonfirmasi admin.

- **Fase 4 — Dashboard ringkas + polish.** KPI (batch aktif, menunggu QC, yield, rework hari ini),
  monitoring mesin harian opsional (`daily_monitoring_*`), badge, dan (opsional) PWA + offline queue
  IndexedDB seperti modul Preventive/Inventory.

---

## 9. Titik Risiko & Keputusan Terbuka (harus disepakati dengan tim :9391)

- **R1 — Auth tulis.** project-epi tidak memakai Firebase; `erp-epi-1` menggerakkan `spk` lewat sesi
  desktop. Perlu sepakati cara aman project-epi menulis ke `spk` (token statis Directus vs endpoint
  khusus), sama seperti keputusan terbuka di modul Inventory.
- **R2 — Kepemilikan `status`.** `spk.status` punya siklus tervalidasi di desktop (validasi customer/
  produk, worksheet, dsb). Harus jelas **nilai/transisi mana yang boleh ditulis lapangan** (mis.
  hanya set timestamp + "menunggu QC") dan mana yang tetap milik admin/QC final — agar tidak merusak
  state di dashboard. Pola aman: lapangan tidak pernah set `finished_goods_status` atau menutup batch.
- **R3 — Hindari pencatatan ganda hasil produksi.** Saat ini "Hasil Produksi" juga tercatat sebagai
  `stock_transactions` (`PRODUCTION_OUTPUT`) via Stock Lapangan. Tentukan **satu sumber kebenaran**:
  apakah `actual_quantity_produced` di `spk` yang memicu stok FG, atau tetap lewat stock_transactions,
  jangan keduanya.
- **R4 — Skema rework & QC.** `production_rework`/`rework_material_consumption`/`qc_results` kosong;
  QC nyata tersimpan sebagai `qc_test_results` (JSON embedded di `spk`). Konfirmasi format JSON persis
  (nama sub-field) supaya cocok dengan yang dibaca desktop — jangan improvisasi struktur.
- **R5 — Pemetaan identitas.** `spk` mencatat pembuat via `user_created` (Directus user), lapangan
  pakai `karyawanId`/`karyawanName`. Sepakati kolom pemetaan resmi (usulan field `operator_id` /
  `qc_by`) daripada mengandalkan pencocokan nama.
- **R6 — Multi-site.** Ada koleksi produksi per lokasi (`balaraja_*`, `ciketing_*`, `ws_*`) dengan
  laporan harian/material/manpower sendiri. Perlu ditetapkan: modul ini fokus ke `spk` pusat, atau
  juga mencakup laporan harian per pabrik? (Usul: mulai dari `spk` pusat, per-site jadi fase lanjutan.)

---

## 10. Kontrak Data (untuk tim admin :9391)

- Modul ini **menambah tulisan** pada field `spk` yang sudah ada; tidak membuat field baru pada Fase 1–2.
- Field baru yang mungkin diperlukan (Fase 0, jika R5 disetujui): `operator_id` (m2o karyawan/personnel)
  dan `qc_by` — **hanya menambah**, tidak mengubah perilaku field existing.
- Semua timestamp ditulis ISO (`new Date().toISOString()`). Field numerik bertipe string di-`parseFloat`.
- Foto diunggah ke `directus_files`, direferensikan sebagai UUID (`qc_photo_id`, dsb); render via
  `${API_URL}/assets/{id}`.
- Idempotensi: submit "Mulai"/"Selesai" harus aman diulang (cek timestamp sudah terisi sebelum PATCH).

---

## 11. Yang Sengaja Ditunda

- PWA + offline queue (Fase 4, opsional) — jaringan lantai pabrik biasanya stabil, prioritas lebih
  rendah dari modul lapangan luar.
- Monitoring mesin harian (`daily_monitoring_screw/piston`) — butuh konfirmasi field & kebutuhan.
- Modul per-site (`balaraja_*`/`ciketing_*`/`ws_*`) — fase lanjutan setelah `spk` pusat stabil.
- Costing/akuntansi produksi — di luar cakupan lapangan.

---

## 12. Pertanyaan untuk Ditutup Sebelum Fase 0 Selesai

1. Apakah pemicu stok FG dari `spk` atau `stock_transactions`? (R3)
2. Transisi `status` mana yang menjadi hak lapangan? (R2)
3. Cara auth tulis project-epi ke koleksi produksi? (R1)
4. Setuju menambah `operator_id`/`qc_by` di `spk`? (R5)
5. Cakupan: `spk` pusat saja dulu, atau termasuk laporan harian per pabrik? (R6)
