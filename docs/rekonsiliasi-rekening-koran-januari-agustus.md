# Blueprint & Panduan Eksekusi Rekonsiliasi Rekening Koran (Januari – Agustus 2026)
**PT Eltama Prima Indo | ERP Admin (`erp-epi-1`) & Dashboard Lapangan (`project-epi`)**

*Verified on:* 2026-09-12  
*Verified against:* Live Directus API (`https://directus.eltamaprimaindo.com`), source code `erp-epi` & `project-epi`, dan 3 dokumen mutasi rekening koran Januari 2026 (BCA Giro 7402407169, BCA Tahapan 6330382064, SeaBank 901988864362).  
*Relevant area:* Modul Finance, Kas & Bank, Rekonsiliasi, PO Procurement, Biaya Lapangan & n8n Automation.  
*Confidence:* Confirmed fact (struktur rekening, skema koleksi Directus, dan relasi transaksi aktual telah diverifikasi).

---

## 1. Analisa Ekosistem Finansial Multi-Rekening (Hasil Bedah Data Januari 2026)

Dari hasil audit 3 dokumen mutasi rekening koran Januari 2026, teridentifikasi ekosistem aliran dana tertutup (*closed-loop cash circulation*) antara perusahaan, direktur/manajemen, dan tim operasional lapangan:

### Ringkasan Angka Rekonsiliasi Januari 2026:
1. **BCA Giro PT Eltama Prima Indo (7402407169)**:
   - Saldo Awal: **Rp 23.467.782,18** | Saldo Akhir: **Rp 7.445.456,18**
   - Mutasi Masuk (CR): **Rp 1.257.260.850,00** (22 transaksi)
   - Mutasi Keluar (DB): **Rp 1.273.283.176,00** (348 transaksi, didominasi ratusan biaya BI-FAST Rp 2.500)
2. **BCA Tahapan Elvian Helmi (6330382064)**:
   - Saldo Awal: **Rp 43.746.985,79** | Saldo Akhir: **Rp 17.231.530,85**
   - Mutasi Masuk (CR): **Rp 123.385.491,32** (12 transaksi)
   - Mutasi Keluar (DB): **Rp 149.900.946,26** (36 transaksi, termasuk transfer balik ke PT Rp 30 Juta & Rp 50 Juta)
3. **SeaBank Elvian Helmi (901988864362)**:
   - Saldo Awal: **Rp 1.048.832,00** | Saldo Akhir: **Rp 9.149.182,00**
   - Mutasi Masuk (CR): **Rp 93.051.351,00** (didominasi 8x transfer dari BCA Giro PT total Rp 93.021.590)
   - Mutasi Keluar (DB): **Rp 84.951.001,00** (Shopee Rp 38+ Juta, transfer mandor/vendor kecil Rp 46+ Juta)

---

## FASE 1: Standarisasi Data & Ekstraksi Multi-Rekening (Januari s/d Agustus)

### Sasaran:
Mengonversi dokumen mutasi 8 bulan (PDF/XLSX) menjadi dataset JSON normal tanpa selisih 1 rupiah pun, dengan atribut pembeda yang konsisten.

### Format Data Normalisasi (JSON Item):
```json
{
  "account_type": "BCA_GIRO_EPI | BCA_EH | SEABANK_EH",
  "account_number": "7402407169 | 6330382064 | 901988864362",
  "transaction_date": "2026-01-02",
  "description_raw": "BIF TRANSFER KE 535 ELVIAN HELMI KBB",
  "direction": "OUT",
  "amount": 18932639,
  "running_balance": 118647556.18,
  "category_heuristic": "INTER_ACCOUNT_TRANSFER",
  "extracted_entity": "ELVIAN HELMI",
  "extracted_ref": "PO1254 | KASBON | BIF",
  "contra_coa": "1149-099"
}
```

### Konvensi Arah Arus Kas:
- **Di Buku Perusahaan (ERP)**:
  - `debit_amount` = **Uang Masuk** (menambah kas perusahaan, di bank tercatat CR).
  - `credit_amount` = **Uang Keluar** (mengurangi kas perusahaan, di bank tercatat DB).
- **Aturan Heuristik Kolom**:
  - BCA (1 kolom Mutasi dengan penanda DB/CR di ujung), tanda `DB` otomatis dipetakan ke `credit_amount` (Keluar), dan `CR` ke `debit_amount` (Masuk).
  - Biaya transfer BI-FAST (Rp 2.500) yang tercatat sebagai baris terpisah wajib ditandai `category: "BANK_ADM_FEE"`.

> [!IMPORTANT]
> **Pertanyaan Kunci Fase 1:**  
> *Apakah untuk periode Februari hingga Agustus, Anda sudah memiliki file rekening koran dalam bentuk file PDF asli dari bank (seperti contoh Januari ini), atau sebagian sudah ada dalam format ekspor Excel/CSV dari KlikBCA / Internet Banking?*

---

## FASE 2: Matriks Aturan Rekonsiliasi Silang (Cross-Account & ERP Matching Rules)

### Sasaran:
Membangun logika rekonsiliasi yang secara otomatis mendeteksi 4 kelompok transaksi tanpa memerlukan intervensi manual yang melelahkan.

| Kategori Transaksi | Pola Teks / Regex | Akun Lawan (COA) | Toleransi & Syarat Match |
|---|---|---|---|
| **1. Transfer Antar-Rekening (Ayat Silang)** | `ELVIAN HELMI`, `pindah dana`, `PINDAH DANA KE BCA EH`, `SWITCHING` | `1149-099` (Ayat Silang / Kas & Bank) | **Nominal identik 100%**, tanggal selisih $\le 1$ hari. Mutasi DB di Giro = Mutasi CR di SeaBank/BCA EH. |
| **2. Pembelian Material & Vendor (PO)** | `PO\s*\d{3,5}`, `PBY INV`, `PBY 50%`, `PELUNASAN`, nama vendor PT | `2110-001` (Utang Usaha / Vendor) | Nominal sama dengan invoice / PO, atau terdapat kecocokan nomor PO di modul Procurement. |
| **3. Kasbon & Gaji Lapangan (Manpower)** | `GAJI MP`, `KASBON`, `BRNGN`, `REIMB`, `REMBURS`, `MITRA DP` | `6131-001` (Biaya Gaji) / `1149-098` (Uang Muka Proyek) | Cocokkan dengan nama Project Leader / Mandor (Taufik, Anwar, Sukriadi, Panji, dll.). |
| **4. Administrasi & Biaya Bank** | `BIAYA TXN`, `BIAYA ADM`, `BI-FAST DB.*2,500` | `8121-003` (Beban Adm Bank) | Nominal Rp 2.500, Rp 20.000, Rp 30.000 otomatis reconcile. |
| **5. Bunga & Pajak Bunga** | `Bunga Tabungan`, `BUNGA`, `Pajak Bunga` | `7111-001` (Pendapatan Bunga) & `8121-002` (Pajak Bunga) | Otomatis reconcile per tanggal buku. |
| **6. Pembayaran Customer (Piutang)** | `po \d+.*pry`, `cicilan PPA`, `payment.*FO` | `1120-001` (Piutang Usaha) | Cocokkan dengan Invoice Customer & Nilai Masuk. |

> [!IMPORTANT]
> **Pertanyaan Kunci Fase 2:**  
> *Untuk pengeluaran kasbon/gaji tenaga kerja lapangan yang ditransfer via Project Leader (misal Pak Anwar Hidayat atau Pak Muhammad Taufik), apakah selama ini pencatatan di pembukuan diakui per orang pekerja di bawahnya atau diakui sebagai 1 paket pengeluaran proyek (SPK Borongan)?*

---

## FASE 3: Master Prompt Claude untuk Eksekusi Batch

### Sasaran:
Prompt standar yang siap di-copy-paste ke sesi Claude bersama file PDF/teks mutasi rekening untuk menghasilkan output rekonsiliasi yang presisi tanpa error perhitungan.

```markdown
### MASTER PROMPT CLAUDE: REKONSILIASI REKENING KORAN MULTI-BANK

Anda adalah Lead Financial Auditor & ERP Data Specialist untuk PT Eltama Prima Indo.
Tugas Anda adalah melakukan ekstraksi, klasifikasi, dan rekonsiliasi silang atas rekening koran multi-bank berikut untuk periode [BULAN TAHUN]:
1. BCA Giro Perusahaan (No. Rek: 7402407169 - PT Eltama Prima Indo)
2. BCA Tahapan Operasional (No. Rek: 6330382064 - Elvian Helmi)
3. SeaBank Operasional (No. Rek: 901988864362 - Elvian Helmi)

### INSTRUKSI AUDIT & REKONSILIASI:
1. Ekstraksi seluruh baris mutasi tanpa ada yang terlewat. Total mutasi Masuk (CR), Keluar (DB), Saldo Awal, dan Saldo Akhir HARUS COCOK 100% dengan ringkasan rekening di halaman muka.
2. Identifikasi dan pasangkan "Transfer Antar Rekening Internal (Ayat Silang)":
   - Catat setiap pasangan transfer dari BCA Giro ke SeaBank/BCA EH atau sebaliknya.
   - Verifikasi apakah tanggal dan nominalnya klop (selisih <= 1 hari).
   - Berikan status: [MATCHED_INTERNAL] jika klop, atau [DISCREPANCY_INTERNAL] jika ada selisih.
3. Ekstraksi nomor PO (Purchase Order) pada kolom keterangan transaksi (contoh: "PO1254", "PO1003", "PO1407") dan petakan ke COA Utang Usaha (2110-001).
4. Ekstraksi pembayaran tenaga kerja/mandor lapangan (kata kunci: GAJI MP, KASBON, BRNGN, REIMB) dan petakan ke Akun Beban Gaji/Borongan Proyek (6131-001).
5. Kelompokkan biaya transaksi perbankan (BI-FAST Rp 2.500 dan Biaya Adm) ke COA Beban Adm Bank (8121-003).

### OUTPUT FORMAT:
Berikan output dalam 3 blok terpisah:
1. Ringkasan Rekonsiliasi Eksekutif (Tabel Markdown)
2. Daftar Transaksi Anomali / Butuh Konfirmasi Manual (Unmatched)
3. JSON Array Lengkap untuk Import Directus
```

> [!IMPORTANT]
> **Pertanyaan Kunci Fase 3:**  
> *Apakah Anda ingin menjalankan rekonsiliasi ini sekaligus per 1 bulan (Januari, lalu Februari, dst.) agar Claude tetap memiliki context window yang leluasa dan tingkat akurasi 100%, atau langsung digabung beberapa bulan sekaligus?*

---

## FASE 4: Integrasi Directus & Pipeline n8n (Tanpa Beban Server)

### 1. Kepatuhan Standar Directus & SvelteKit
- **Aturan Pemisahan Relasi (Strict Rule)**: Sesuai pedoman project, tidak melakukan deep nested relations dalam 1 request untuk mencegah error 403.
  - Request 1: Ambil `bank_reconciliation` header.
  - Request 2: Ambil `bank_reconciliation_items` dengan pagination limit 100/batch.
  - Request 3: Ambil `bank_accounts` secara independen untuk metadata nomor rekening dan COA.
- **Payload Directus Batch**: Ingestion hasil JSON dari Claude ke endpoint `/items/bank_reconciliation_items` menggunakan batch POST (maksimal 50 baris per batch agar API Directus tidak timeout).

### 2. Workflow n8n (Automated Reconciliation Pipeline)
1. **Webhook Ingestion**: n8n menerima payload hasil rekonsiliasi yang telah diproses.
2. **Cross-Check Engine**: n8n mengeksekusi validasi otomatis:
   - Cek apakah Pindah Dana Giro DB = Pindah Dana SeaBank/BCA CR.
   - Cek nomor PO yang terdeteksi ke koleksi `purchase_orders` di Directus.
3. **Daily Digest Alert**: Mengirimkan rekap status rekonsiliasi dan notifikasi anomali mutasi yang belum teridentifikasi ke tim Finance.

> [!IMPORTANT]
> **Pertanyaan Kunci Fase 4:**  
> *Apakah hasil rekonsiliasi ini cukup disimpan sebagai draft di tabel `bank_reconciliation_items` untuk di-review terlebih dahulu di UI, atau langsung otomatis di-posting ke Jurnal Keuangan (`journal_entries`)?*

---

## FASE 5: Rekomendasi Fitur Unggulan untuk Dashboard Admin & Lapangan

### 1. Rekomendasi Dashboard Admin (`erp-epi-1` / `erp-epi`)
1. **Fitur "Twin-Leg Inter-Account Matcher" (Pencocok Dana Silang Otomatis)**:
   - *Masalah saat ini:* Transfer dari BCA Giro ke SeaBank dan BCA EH mencapai puluhan kali dalam sebulan. Admin harus mencocokkannya dua kali di masing-masing rekening.
   - *Solusi:* Begitu sistem mendeteksi mutasi keluar di BCA Giro bertuliskan `ELVIAN HELMI` dan mutasi masuk di SeaBank/BCA EH dengan nilai yang sama persis, status kedua baris langsung otomatis berubah menjadi `RECONCILED (INTERNAL_TRANSFER)` dengan 1 klik.
2. **Fitur "BI-FAST Collapsible View" (Pembersih Tampilan Mutasi)**:
   - *Masalah saat ini:* Pada rekening BCA Giro Januari, terdapat lebih dari 150 baris potongan `BI-FAST TXN KE ... Rp 2.500` yang membuat rekening koran menjadi 42 halaman dan memperlambat render halaman browser.
   - *Solusi:* Di UI `ReconciliationWorksheet.svelte`, buat toggle switch: `"Sembunyikan Biaya Admin Rp 2.500"`. Biaya admin tetap tercatat di database namun di UI digabungkan ke ringkasan total di header.
3. **Auto-Match PO Payment Status**:
   - Teks mutasi yang mengandung string `PO1254`, `PO1003`, dll. langsung mengaitkan transaksi bank dengan Purchase Order terkait dan memberi tanda verifikasi `"Paid by Bank Transfer"`.

### 2. Rekomendasi Dashboard Lapangan (`project-epi`)
1. **Field Cash Request with Preset Beneficiary (Pencegah Salah Transfer)**:
   - *Masalah saat ini:* Mandor dan project leader sering menerima dana operasional ke berbagai rekening (BCA, Mandiri, BRI).
   - *Solusi:* Di `project-epi` pada menu `biaya-lapangan` / `pusat-pengajuan`, saat leader mengajukan kasbon/operasional, rekening tujuan sudah terkunci dari Master Penerima Dana yang terverifikasi. Ketika admin mencairkan via BCA/SeaBank, referensi transfer dibuat otomatis standar: `[KASBON-ID]-[PROJECT-CODE]`.
2. **Real-Time Disbursement Status Notification via n8n**:
   - Begitu transfer di BCA Giro atau SeaBank berhasil dieksekusi, n8n mengirimkan status ke `project-epi` sehingga Project Leader di lapangan langsung mengetahui bahwa dana untuk mandor/material sudah dikirim tanpa perlu konfirmasi manual lewat WhatsApp.
3. **Offline-First Receipt Capture (PWA Caching)**:
   - Leader di proyek luar pulau (seperti ekspedisi Sorong atau site tambang) dapat memotret nota pembelian cat/sewa scaffolding dalam mode offline. Begitu mendapat sinyal, data terkirim ke server dan siap dicocokkan dengan mutasi rekening koran.

> [!IMPORTANT]
> **Pertanyaan Kunci Fase 5:**  
> *Dari rekomendasi fitur dashboard di atas, manakah yang menjadi prioritas utama Anda: integrasi Twin-Leg Inter-Account Matcher di admin, atau integrasi pengajuan kasbon mandor terverifikasi di dashboard lapangan?*

---

## Lokasi Penyimpanan Dokumen
Dokumen ini tersimpan secara fisik di:
`c:\dev\erp-epi\docs\rekonsiliasi-rekening-koran-januari-agustus.md`  
`c:\dev\project-epi\docs\rekonsiliasi-rekening-koran-januari-agustus.md`  
Dan siap dieksekusi sesuai arahan bertahap pada branch `Major`.
