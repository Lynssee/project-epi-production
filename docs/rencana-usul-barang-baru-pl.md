# Rencana: Jalur "Usul Barang Baru" Packing List (PLG-11)

**Status:** RENCANA. Butuh izin Lead karena mengubah skema Directus produksi. Belum ada kode atau skema yang diubah.
**Syarat:** wajib selesai sebelum `G_PKL_INVENTORY_LINK` dinaikkan ke `hard` (rencana PLG, K2).

## Masalah
Leader yang butuh barang yang belum ada di Master Katalog tidak punya jalan keluar kecuali meminta Admin. Dengan gate `hard`, pengajuan tertahan.

## Yang sudah ada
- `identitas_barang_usulan` + `POST /api/gates/fix/usul-tautan-barang` (project-epi) + kotak masuk `UsulanTautanBarangInbox.svelte` (erp-epi): hanya varian **"tautkan ke barang master yang sudah ada"**. Kolom `usulan_identitas_barang_id` wajib terisi (NOT NULL), jadi tidak bisa mewakili barang yang belum terdaftar.
- Pola pembanding: `ciketing_item_link_request` (erp-epi `ciketingItemLinkApi.js`) sudah punya dua tipe, `link_existing` dan `register_new`.

## Usulan skema (tambah, jangan ubah kolom lama)
Cara teraman: **koleksi baru**, bukan mengubah `identitas_barang_usulan`. Alasan: mengubah kolom produksi pernah menyebabkan FK anak menjadi NULL (insiden alter field 17 Okt). Koleksi baru tidak menyentuh data lama.

`identitas_barang_usulan_baru`
| Kolom | Tipe | Catatan |
|---|---|---|
| id | int PK | |
| project_budget_id | M2O project_budgets | baris PL yang menunggu |
| usulan_nama | string(255) | nama barang yang dibutuhkan |
| usulan_satuan | string(50) | |
| usulan_kategori | string(50) | `packing_*` |
| catatan | text | spesifikasi / alasan |
| status | string | `menunggu` / `diterima` / `ditolak` |
| identitas_barang_id | M2O identitas_barang | diisi saat diterima (barang yang dibuat atau dipilih Admin) |
| diusulkan_oleh_karyawan_id | M2O karyawan | |
| diusulkan_pada | timestamp (date-created) | |
| ditinjau_oleh / ditinjau_pada / alasan_tolak | | sama dengan tabel lama |

## Alur
1. **Lapangan:** di modal PL (tab Manual) dan `/packing-list/baru`, bila saran katalog kosong muncul tombol **"Usul barang baru"**. Leader mengisi nama, satuan, kategori, catatan. Baris tetap bisa dikirim (mode `soft`) dan usulan terhubung ke baris itu. Server: `POST /api/gates/fix/usul-barang-baru` (guard sama dengan `usul-tautan-barang`, satu usulan menunggu per baris).
2. **Admin Logistik (erp-epi):** kotak masuk baru, atau tab kedua di `UsulanTautanBarangInbox`. Aksi: **Daftarkan barang baru** (buat `identitas_barang` lalu tautkan), **Tautkan ke yang sudah ada**, atau **Tolak** (alasan wajib).
3. **Saat diterima:** PATCH `project_budgets.identitas_barang_id` (hanya bila baris belum terkirim / `qty_sudah_dikirim` = 0), usulan menjadi `diterima`.
4. **Gate:** untuk baris dengan usulan `menunggu`, `G_PKL_INVENTORY_LINK` mode `hard` tidak memblokir tetapi tampil sebagai peringatan "menunggu Admin Logistik" (ambang dan perilaku diatur di UI Kalibrasi Gate, Aturan #11). Daftarkan sebagai opsi gate di `gate_definitions` (`action_config`), bukan hardcode.

## Dampak
- Modul: Lapangan (PL), Inventory/Admin Logistik. Finance: tidak ada.
- Skema: 1 koleksi baru + izin baca/tulis untuk peran leader dan logistik (diatur Lead).
- Butuh kapasitas Admin Logistik meninjau usulan (SLA di hint gate: ± 1 jam kerja).

## Keputusan yang dibutuhkan dari Lead
1. Setuju koleksi baru `identitas_barang_usulan_baru` (bukan mengubah koleksi lama)?
2. Boleh Admin Logistik membuat `identitas_barang` baru dari kotak masuk, atau hanya Inventory pusat?
3. Saat usulan masih `menunggu` dan mode `hard`: boleh kirim dengan peringatan (usulan) atau tetap tertahan?

## Menerapkan skema (setelah izin Lead)
Skrip sudah disiapkan dan diuji dry-run pada 3 Nov 2026 (koleksi belum ada, 13 field + 3 relasi akan dibuat):

```bash
node scripts/pl-usul-barang-baru-schema.mjs            # dry-run, hanya membaca
node scripts/pl-usul-barang-baru-schema.mjs --apply    # buat koleksi + relasi, lalu verifikasi
```

Setelah itu Lead mengatur izin Directus per peran (leader: buat + baca miliknya; logistik: baca + ubah). Kode lapangan dan kotak masuk Admin Logistik baru dikerjakan **setelah** skema ada, supaya tidak memukul koleksi yang belum ada (Aturan #1, Directus membalas 403).

## Urutan kerja setelah disetujui
1. Lead menjalankan skrip + mengatur izin.
2. Endpoint `POST /api/gates/fix/usul-barang-baru` + tombol "Usul barang baru" di modal PL dan `/packing-list/baru` (project-epi).
3. Kotak masuk Admin Logistik (erp-epi): daftarkan baru / tautkan ke yang ada / tolak.
4. Daftarkan opsi di registry gate (Aturan #11) dan uji end-to-end.
5. Baru setelah itu `G_PKL_INVENTORY_LINK` boleh dinaikkan ke `hard` (K2).
