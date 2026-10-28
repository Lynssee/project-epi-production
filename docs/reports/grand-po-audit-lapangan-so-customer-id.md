# Audit repo lapangan — pemakaian `so_customer_id` tunggal (Grand PO, 29 Sep 2026)

**Pertanyaan:** setelah proyek digabung (proyek 976 → 978), satu proyek memuat >1 PO jasa (PO utama di `projects.so_customer_id`, PO saudara di `so_customer.project_id`). Kode lapangan mana yang mengasumsikan **satu PO per proyek**?

**Metode:** `git grep so_customer_id` (99 baris, 28 file) + pola lain yang tidak memuat string itu (`getSoCustomerByProjectId`, `getSoCustomerById`, kueri `so_customer` per proyek, `linked_so_id`). Tiap kandidat dibaca konteksnya. Padanan audit erp-epi: `grand-po-fase2-triase-so-customer-id.md`.

## Hasil: 5 titik SALAH untuk proyek gabungan → sudah diperbaiki

| # | File | Masalah | Perbaikan |
|---|---|---|---|
| 1 | `routes/(app)/proyek/[project_id]/+page.svelte` | Info proyek hanya memuat PO utama: item pekerjaan, Nilai PO, nomor PO (juga dipakai cetak Surat Tugas) | Item dari SEMUA PO (`getProjectSoIds` + `getSoCustomerDetailsForSos`), Nilai PO dijumlah, daftar "PO dalam proyek ini" |
| 2 | `routes/(app)/laporan/[project_id]/+page.svelte` | Laporan harian: daftar aktivitas hanya dari PO utama → aktivitas PO kedua tidak bisa dilaporkan | Aktivitas dari semua PO proyek |
| 3 | `lib/server/pembelianLokalProyekSubmit.ts` (`computeProjectPaguSisa`) | Pagu = RAB approved PO utama saja → pagu terlalu kecil → nominal wajar ditandai `failed` | Pagu = jumlah RAB approved semua PO; gagal baca PO saudara → `not_applicable` (bukan diam-diam PO utama saja) |
| 4 | `routes/(app)/inspection/[id]/+page.svelte` | `getSoCustomerByProjectId` (`limit 1`, tanpa urutan) bisa memilih PO saudara secara acak → laporan inspeksi terikat PO/customer yang salah | Prioritaskan PO utama proyek; fallback ke lookup lama |
| 5 | `lib/services/omniReadOnlyApi.ts` | Percakapan omnichannel terkait PO saudara tidak muncul | Tambah PO saudara (1 kueri kecil) |

Helper murni bersama: `lib/utils/projectSoIds.ts` (+ tes); pembungkus I/O: `getProjectSoIds`, `getSoCustomersByIds`, `getSoCustomerDetailsForSos` di `lib/services/projects.ts`.

## Aman / per-SO secara desain (tidak diubah)

| File | Alasan |
|---|---|
| `ProjectCharterTab.svelte`, `projectCharter.ts`, `proyek/+page.svelte` (status charter) | Charter melekat per SO. Charter PO saudara tetap ada tetapi tidak ditampilkan di tab charter proyek gabungan — **catatan**, bukan bug data |
| `soRabApi.ts`, `salesPo.ts`, `pricingApi.ts`, `customerLifecycle*.{js,ts}` | Operasi per SO (RAB/PO/harga/siklus customer) — dipanggil dengan id SO eksplisit |
| `WorkshopManpowerSummaryCard.svelte`, `workshopOpsApi.ts`, `workshopDeliveryApi.ts`, `routes/(app)/workshop/+page.svelte` | Workshop: 1 PO per proyek; gabung proyek hanya untuk PO jasa |
| `ProjectAktualisasiPanel.svelte` | RAB PO utama + `project_budgets` per `project_id` (dedupe id) → baris RAB PO saudara yang ikut pindah tetap terbaca |
| `projectPhaseApi.ts`, `ProjectPhaseWizardCompact.svelte` | Hanya kebenaran-nilai (`if (so_customer_id)`) untuk menentukan fase awal |
| `api/scan/resolve`, `api/kiosk/gerbang-sj/*`, `finishGoodDispatch.ts` | `so_customer_id` milik Surat Jalan itu sendiri, bukan turunan proyek |
| `proyek/+page.svelte` (`computeDuplicateSoIds`) | Deteksi tampilan proyek ganda per SO; proyek sumber yang di-cancel setelah gabung tidak tampil |
| `inspectionApi.ts` | Kolom `so_customer_id` milik laporan inspeksi (diisi dari perbaikan #4) |

## Verifikasi
- Tes: `projectSoIds.test.ts` (helper), `pembelianLokalProyekSubmit.pagu.test.ts` (pagu multi-PO, proyek 1-PO, gagal-baca → N/A) + seluruh tes Grand PO lapangan: **51 lulus**. Vitest dijalankan dengan binary erp-epi (belum terpasang di project-epi).
- Kompilasi Svelte: jumlah warning tiga halaman yang diubah **sama dengan HEAD** (0 / 50 / 2).
- Cek live PROD (GET saja): `computeProjectPaguSisa` untuk proyek 978, 976, 575 → tanpa 403; kueri `so_rab` memakai `_in` sesuai jumlah PO.
- **Belum**: UI tidak dilihat di browser (butuh login Firebase); hasil proyek gabungan sungguhan baru bisa dicek setelah penggabungan 976→978 dieksekusi.

## Keterbatasan audit
Pencarian berbasis string; kode yang menurunkan PO lewat variabel/nama lain (mis. `soId` dari `project.so`) yang tidak memuat kata `so_customer` tidak terdeteksi. Titik seperti itu ditelusuri lewat `getSoCustomerBy*`, `linked_so_id`, dan `nomor_po`; tidak ditemukan tambahan.
