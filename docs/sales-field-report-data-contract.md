# Kontrak Data — Sales Field Reporting (Fase 0-4 sebagian, diimplementasikan 2026-07-01)

Backend Directus dipakai bersama oleh project-epi (lapangan, `:5174`) dan dashboard admin `erp-epi-1` (`:9391`).
Field di bawah ini adalah "kabel" yang menghubungkan keduanya — dijaga konsisten oleh kedua app.
Referensi rencana lengkap: `Rencana_Sales_Field_Reporting_project-epi.pdf` (Departemen Sales, 1 Juli 2026).

## Field baru di `visit_sales`

Koleksi `visit_sales` sudah ada sebelumnya (`id, tanggal_kunjungan, sales_name, tujuan, kendaraan_id, kegiatan, status`)
dan tetap dipakai apa adanya oleh `VisitSales.svelte` di `erp-epi-1` (form manual admin). Field baru di bawah
khusus untuk alur verifikasi kunjungan lapangan — **terpisah** dari field `status` yang sudah ada (siklus
open/in_progress/completed/cancelled tidak diubah).

| Field | Tipe | Keterangan |
|---|---|---|
| ~~`customer_id`~~ | integer (m2o → `so_customer`) | **Kesalahan Fase 0/1, tidak dipakai.** `so_customer` adalah baris Sales Order (banyak per customer), bukan master customer — field ini salah arah. Dibiarkan ada di skema (tidak dihapus, MCP Directus tool menolak delete demi keamanan) tapi kode tidak pernah menulis/membaca field ini. |
| `master_customer_id` | integer (m2o → `master_customer`) | **Pengganti yang benar.** Customer yang dikunjungi, diisi dari picker di project-epi yang query `master_customer` (field `nama_sj_fp`), field ini yang konsisten dipakai `getCustomerByCode` di seluruh erp-epi-1. |
| `sales_id` | integer (m2o → `karyawan`) | Identitas sales (karyawan divisi SALES), diisi dari `authStore.karyawanId`. |
| `check_in_at` | timestamp | Waktu tiba di lokasi — diisi otomatis saat sales menekan "Check-in". |
| `check_out_at` | timestamp | Waktu submit kunjungan (selesai). |
| `latitude` / `longitude` | float | Koordinat GPS browser saat check-in — bukti lokasi. |
| `foto_id` | uuid (m2o → `directus_files`) | **Satu foto** bukti kunjungan (disederhanakan dari rencana awal m2m banyak foto — cukup untuk pilot Fase 1). |
| `hasil_kunjungan` | text | Ringkasan hasil pertemuan, diisi sales saat submit. |
| `follow_up_date` | date | Rencana tindak lanjut (belum dihubungkan ke reminder otomatis — lihat "Belum dikerjakan"). |
| `verifikasi_status` | string (`draft`\|`submitted`\|`verified`\|`rejected`), default `draft` | Alur verifikasi SPV. |
| `verified_by` | string (m2o → `directus_users`) | **Belum diisi otomatis** — lihat catatan di bawah. |
| `verified_at` | timestamp | Waktu approve/reject, diisi manual oleh panel verifikasi. |
| `catatan_spv` | text | Alasan tolak / catatan SPV. Wajib diisi saat reject di panel `:9391`. |

## Alur end-to-end yang sudah jalan

1. Sales buka `/sales/baru` di project-epi → pilih customer → tekan "Check-in Sekarang" →
   `checkInVisit()` (`src/lib/services/sales.ts`) membuat row `visit_sales` baru dengan
   `check_in_at`, `latitude`, `longitude`, `verifikasi_status='draft'`.
2. Redirect ke `/sales/[id]` → sales isi hasil kunjungan, foto (opsional), rencana follow-up →
   tekan "Submit Kunjungan" → `submitVisit()` set `check_out_at`, `foto_id`, `status='completed'`,
   `verifikasi_status='submitted'`.
3. Di `erp-epi-1`, komponen `VisitSales.svelte` (menu Sales → Visit) menampilkan kolom "Verifikasi" dan
   tombol Review untuk baris `submitted`. Modal review menampilkan link Google Maps dari GPS, foto bukti,
   dan hasil kunjungan. SPV menekan **Setujui** atau **Tolak** (wajib isi catatan) →
   PATCH `verifikasi_status`, `catatan_spv`, `verified_at`.

## Koleksi baru — `sales_daily_report` (Fase 2: Laporan Harian Sales)

| Field | Tipe | Keterangan |
|---|---|---|
| `sales_id` | integer (m2o → `karyawan`) | Sales yang lapor. |
| `sales_name` | string | Snapshot nama sales. |
| `tanggal` | date | 1 laporan per sales per hari (dicek client-side via `getTodayDailyReport`, bukan unique constraint DB). |
| `total_kunjungan` | integer | Dihitung otomatis dari `visit_sales` (`countTodayVisits`) — sales tidak input manual. |
| `total_order` | float | Estimasi omzet/order hari ini, opsional, input manual sales. |
| `ringkasan` | text | Wajib diisi. |
| `kendala` | text | Opsional. |
| `verifikasi_status` | string, default `submitted` | Beda dari `visit_sales`: laporan harian langsung `submitted` saat dibuat (tidak ada tahap draft terpisah — satu form, sekali submit sesuai rencana #4). |
| `catatan_spv` / `verified_at` | text / timestamp | Sama pola dengan `visit_sales`. |

Alur: sales buka `/sales/laporan-harian` di project-epi (maks 1x per hari, dicek `getTodayDailyReport`) →
isi ringkasan + kendala + order → submit. Di `erp-epi-1`, kartu "Laporan Harian Sales" di
`DailySalesDashboard.svelte` (`/sales/daily`, tab yang sama dgn Visit Sales hari ini) menampilkan laporan
untuk tanggal terpilih dengan tombol Setujui/Tolak (reject pakai `prompt()` browser untuk catatan — sederhana,
konsisten dgn constraint "static API token" yang sama seperti verifikasi visit).

## Pipeline Prospek & Reminder (Fase 3) — reuse penuh, tidak ada koleksi baru

**Temuan penting:** erp-epi-1 sudah punya modul CRM lengkap (dashboard, pipeline, leads, aktivitas, quotation)
live di `/crm` (`src/lib/components/crm/*.svelte`, service `src/lib/services/crmApi.js`), memakai koleksi
`prospects` (stage: new/qualified/proposal/negotiation/won/lost, field `assigned_name` = nama sales) dan
`follow_ups` (`prospect_id`, `type`, `next_follow_up`, `completed`, `result`). Sisi lapangan project-epi
sekarang jadi **klien mobile kedua** ke koleksi yang sama — field & nilai enum di
`src/lib/services/sales.ts` (`PROSPECT_STAGES`, `ProspectStage`, `FollowUpType`) sengaja disamakan persis
dengan `crmApi.js` (`STAGES`, `ACTIVITY_TYPES`) supaya tidak ada drift antara app admin dan lapangan.

Route project-epi:
- `/sales/prospek` — daftar lead milik sales (`assigned_name = karyawanName`), filter chip per stage.
- `/sales/prospek/baru` — buat lead baru (`stage='new'`, `priority='medium'` default).
- `/sales/prospek/[id]` — ubah stage (tap-to-set, bukan drag-drop kanban — lebih cocok mobile), riwayat
  aktivitas (follow_ups), tambah aktivitas baru dengan `next_follow_up` opsional.
- Widget reminder di `/sales` (halaman utama): follow_ups milik prospek sales ini yang `completed=false` dan
  `next_follow_up` &le; hari ini.

**Tidak disentuh:** erp-epi-1 `/crm` tidak diubah sama sekali — sales & admin melihat data yang sama secara
real-time tanpa perlu sinkronisasi tambahan karena keduanya baca/tulis koleksi Directus yang sama.

## Master Customer + Histori (item #6 rencana)

Route `/sales/customer/[id]` (id = `master_customer.id`) menggabungkan riwayat kunjungan (`visit_sales` via
`master_customer_id`) dan lead/aktivitas (`prospects` via `customer_id`, + `follow_ups`-nya) untuk satu
customer — **dibatasi ke data milik sales yang login** (filter `sales_name`/`assigned_name`), bukan histori
lintas-sales, untuk menjaga privasi data lead antar sales. Diakses dari tombol "Lihat histori customer" di
halaman detail kunjungan (`/sales/[id]`).

## Fase 4 (Penunjang & Analitik) — sebagian: Target vs Realisasi & Survey Lokasi

**Target vs Realisasi (#7):** reuse `sales_target` (target_amount per sales/bulan/tahun, sudah ada) vs
realisasi dihitung on-the-fly dari `SUM(so_customer.grand_total)` untuk `sales_name` & bulan berjalan
(exclude status `cancelled`). Ditampilkan sebagai progress bar di `/sales`. Tidak ada koleksi baru — kalau
`sales_target` kosong untuk sales/bulan tsb, widget tidak tampil (bukan dianggap 0%).

**Survey Lokasi/Kebutuhan (#9):** reuse penuh `sales_survey` + junction `sales_survey_images` (skema & konvensi
disamakan dgn `erp-epi-1/src/lib/services/salesSurveyApi.js`, termasuk generator nomor `SRV-YYYY-NNNN`).
Route `/sales/survey` (riwayat, filter `surveyor = karyawanName`) dan `/sales/survey/baru` (form lengkap:
lokasi, PIC, luas area, kondisi permukaan, ketersediaan listrik/air/toilet, jam kerja, shift, akomodasi,
safety, catatan, multi-foto). `survey_mode` dikunci ke `'dengan_survey'` dan `status='completed'` langsung saat
submit — karena form ini representasi "sales sudah di lokasi", bukan keputusan awal survey/tidak-survey yang
tetap jadi keputusan kantor (di luar cakupan mobile).

**Kalkulator Penawaran mobile (#8) — diimplementasikan dengan port formula, bukan asumsi.**
Sebelum coding, source lengkap dibaca: `erp-epi-1/src/lib/utils/quotationCalc.js` (rumus murni),
`quotationCalcApi.js` (persistensi), dan 3 sub-form (`SandblastingForm`/`PaintingForm`/`FloorCoatingForm`).
Hasilnya:

- `src/lib/utils/quotationCalc.ts` — **port verbatim** (logika sama persis, hanya sintaks JS→TS) dari
  `calcSandblasting`, `calcPainting`, `calcFloorCoating`, `calcQuotationTotals`, dan konstanta terkait
  (`ABRASIVE_CONSUMPTION`, `APPLICATION_METHODS`, `PRODUCTIVITY_FACTORS`, dst). Diverifikasi dengan hitung
  manual (bukan cuma "kelihatan jalan") — angka material/equipment/subtotal cocok persis untuk kasus uji
  sandblasting & painting sebelum dipakai di UI.
- **Scope dipersempit ke 3 tipe jasa** (Sandblasting, Painting, Floor Coating) — **bukan pengurangan
  sepihak**, tapi mengikuti fakta yang ditemukan di skema: `kalkulator_penawaran_items.service_type` di
  Directus formal hanya punya 3 pilihan itu (Sipil & Welding ada di kode JS `SERVICE_TYPES` erp-epi-1 tapi
  belum direfleksikan ke skema field choices) — dan subtitle halaman desktop sendiri menyebut
  "Sandblasting · Painting · Floor Coating", sama seperti fokus utama dokumen rencana ("floor coating dll").
- `src/lib/services/kalkulatorPenawaran.ts` — port `quotationCalcApi.js` (getAllRates, generateNomorPenawaran
  format `PNW/YYYY/NNNN`, fetchKalkulatorConfig, savePenawaranFull) pakai Directus SDK, kolom/koleksi identik:
  `kalkulator_penawaran`, `kalkulator_penawaran_items`, `kalkulator_material_rate`, `kalkulator_resource_rate`.
- **Manpower global**: direplikasi persis pola desktop yang agak tidak intuitif — biaya tenaga kerja
  dihitung dari satu tim global (`header.manpower`) × total hari kerja (jumlah hari semua item, berurutan),
  BUKAN dari field manpower per-item. Item hanya pakai jumlah crew global untuk membagi produktivitas/hari
  kerja. Ini disimpan sebagai baris item tersendiri `service_type: 'global_manpower'` (di luar 3 enum formal,
  tapi konsisten dengan cara desktop menyimpannya — Directus tidak menegakkan enum `select-dropdown` di level DB).
- Route project-epi: `/sales/penawaran` (daftar + aksi ubah status Kirim/Diterima/Ditolak), `/sales/penawaran/baru`,
  `/sales/penawaran/[id]` — keduanya pakai komponen bersama `src/lib/components/sales/PenawaranEditor.svelte`.
- **Sengaja TIDAK diporting** (di luar rumus harga, risiko rendah untuk dilewati): AI auto-fill dari dokumen,
  export PDF, konversi ke RAB, sistem revisi, template tersimpan (localStorage), kalkulator luas dari dimensi
  geometris (`surfaceAreaCalc.js`), dan estimasi jadwal Gantt. Field `komisi_amount` dipakai di rumus totals
  desktop tapi **tidak ada di skema Directus** `kalkulator_penawaran` — tidak diimplementasikan di project-epi
  juga (selalu dianggap 0) supaya tidak ada UI yang terlihat tersimpan padahal tidak.

Rute & Absensi Harian (#10) tetap belum dikerjakan — ditandai "Opsional" di rencana asli, prioritas terendah.

## Yang disederhanakan / belum dikerjakan (perlu keputusan tim :9391 sebelum lanjut Fase 2+)

- **Tidak ada Directus Flow notifikasi** ke SPV saat status berubah ke `submitted` — belum jelas siapa SPV
  penanggung jawab per sales (butuh keputusan: verifikasi 1 tingkat atau berjenjang, lihat rencana bagian 8).
  Untuk sekarang, SPV memantau lewat filter "Menunggu Verifikasi" di tabel Visit Sales.
- **`verified_by` tidak diisi otomatis** — panel verifikasi di `erp-epi-1` memakai token API statis
  (`DIRECTUS_TOKEN`), bukan sesi login per-user, jadi tidak ada identitas Directus user yang bisa dicatat
  tanpa perubahan arsitektur auth di app tersebut.
- **Foto bukti dibatasi 1 file** (`foto_id`, bukan m2m banyak foto) untuk mempercepat pilot Fase 1.
- **Pipeline Prospek (Fase 3)** dan **Master Customer + Histori (#6)**: sudah dikerjakan, lihat bagian di atas.
- **Target vs realisasi (#7)**, **Kalkulator Penawaran (#8)**, dan **Survey Lokasi (#9)** juga sudah punya
  koleksi masing-masing (`sales_target`, `kalkulator_penawaran`, `sales_survey`) — belum disambungkan ke
  aplikasi lapangan project-epi, ini scope Fase 4 berikutnya.
- **Omnichannel (Fase 2) belum disentuh** — halaman di project-epi masih data contoh. Ini butuh keputusan
  eksternal (provider: Chatwoot / WhatsApp Business API / lainnya) sebelum bisa dikerjakan — lihat rencana
  bagian 8 "Hal yang perlu diklarifikasi".

## Yang perlu diperhatikan tim admin `:9391`

- Field baru di atas hanya menambah, tidak mengubah field/behavior `visit_sales` yang sudah dipakai
  `VisitSales.svelte` (form manual, filter, CRUD) — aman untuk data existing.
- `foto_id` disimpan sebagai UUID tunggal ke `directus_files`; render via `${API_URL}/assets/{foto_id}`.
- Sebelum Fase 2 (Flow notifikasi SPV, laporan harian sales), sepakati dulu struktur role SPV per sales di
  `erp-epi-1` — saat ini panel verifikasi terbuka untuk siapapun yang mengakses menu Sales → Visit.
- Field `visit_sales.customer_id` (integer) ada di skema tapi TIDAK dipakai kode manapun — jangan pakai untuk
  fitur baru, pakai `master_customer_id`. Kalau nanti perlu housekeeping skema, field ini aman dihapus manual
  lewat Directus Studio (bukan lewat MCP tool yang dipakai sesi ini).
