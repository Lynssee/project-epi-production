# Kontrak Data — Field Reporting Dashboard (Fase 0-2, diimplementasikan 2026-07-01)

Backend Directus dipakai bersama oleh project-epi dan dashboard admin inventory (:9391).
Field & Directus Flows di bawah ini adalah "kabel" yang menghubungkan keduanya — dijaga konsisten oleh kedua app.

## Field baru

| Koleksi | Field | Tipe | Keterangan |
|---|---|---|---|
| `project_expenses` | `identitas_barang_id` | integer (m2o → `identitas_barang`) | Link ke master katalog. Diisi otomatis saat leader memilih material dari inventory proyek yang sudah ada `identitas_barang_id`-nya (lihat catatan migrasi di bawah). |
| `project_expenses` | `expense_type = 'consumption'` | string (nilai baru) | Baris konsumsi yang dibuat otomatis oleh Flow A. Beda dari `'supplier'` (barang masuk) yang sudah ada. |

`reports.material_used[]` dan `reports.material_needs[]` (JSON, tidak berstruktur secara skema) sekarang membawa
field `identitas_barang_id` per baris — dipakai oleh Flow A/B untuk mencocokkan ke master katalog.

## Directus Flows baru (aktif di instance ini)

1. **Field Report: Flow A — Potong Stok saat Submit Laporan**
   Trigger: `items.create` pada `reports`. Untuk tiap baris `material_used[]` yang punya `identitas_barang_id`:
   kurangi `identitas_barang.stok_tersedia`, buat baris `project_expenses` (`expense_type='consumption'`).
   Idempoten by design: hanya jalan sekali per `reports` row yang dibuat.

2. **Field Report: Flow B — Auto Packing Request (Urgent)**
   Trigger: `items.create` pada `reports`. Untuk tiap baris `material_needs[]` dengan `urgency='urgent'`
   (atau `is_urgent`/`priority`): buat `project_budgets` baru dengan `packing_status='requested'`.

3. **Field Report: Flow C — Terima Pengiriman (Delivered)**
   Trigger: `items.update` pada `project_budgets`. Saat `packing_status` diubah menjadi `'delivered'`:
   buat `project_expenses` (`expense_type='supplier'`) sebesar `qty_sudah_dikirim`.
   Idempoten via cek `source = 'packing:<budget_id>'` sebelum insert.

## Yang perlu diperhatikan tim admin :9391

- `identitas_barang.stok_tersedia` bertipe **string** di skema Directus (bukan angka) — jangan lakukan operasi
  matematis langsung di query tanpa `parseFloat`/cast, ikuti pola yang sama seperti Flow di atas.
- Baris `project_expenses` lama (sebelum 2026-07-01) **tidak** punya `identitas_barang_id` terisi — hanya
  baris baru yang dibuat lewat form Laporan Harian (setelah update ini) yang membawanya. Perlu backfill
  data historis terpisah jika ingin laporan HPP/rekonsiliasi mencakup data lama.
- `packing_returns.project_id` tidak punya foreign key resmi di skema (integer bebas) — belum diubah di
  pekerjaan ini, rekonsiliasi retur fisik vs sistem (Fase 3 penuh) masih perlu dirancang terpisah dengan tim :9391.
- Dashboard admin :9391 berada di repo terpisah (`erp-epi-1`, folder `src/routes/inventory`) — tidak disentuh
  di pekerjaan ini karena di luar working directory project-epi.
