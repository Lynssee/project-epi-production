# Rencana Implementasi: Skema Partial Delivery, Non-PO, & Gate Invoice Workshop Ciketing

> **Branch:** `Major`  
> **Target Lokasi:**
> - Admin Dashboard: `C:\dev\erp-epi\src\routes\ws-ciketing\` (`internal.eltamaprimaindo.com`)
> - Field Dashboard: `C:\dev\project-epi\src\routes\(app)\workshop\` (`project.eltamaprimaindo.com`)
> - Backend & Otomasi: Directus (Separate relation fetching) & n8n

---

## 1. Analisa Kondisi Sistem Saat Ini & Temuan Arsitektur

Berdasarkan hasil inspeksi langsung pada kode sumber:

1. **Dashboard Admin (`erp-epi`):**
   - Komponen inti: `WsCiketing.svelte` (12.361 baris) di `src/lib/components/finance/project/WsCiketing.svelte`.
   - Modul yang sudah jalan: Pusat Order, Daily Report (blasting, primer, second, topcoat), Progress Monitoring, Inventory mandiri (`ciketing_item`, rak, mutasi), Surat Jalan Keluar (`WsCiketingSjKeluarTab`), serta integrasi invoice `createInvoiceFromCiketingSJKeluar`.
   - **Kelemahan/Gap:** Surat Jalan keluar dan faktur tagihan selama ini mengasumsikan kuantitas gelondongan (full shipment per order). Belum ada mekanisme pemecahan item granular (*split shipment*) dan penanganan order fisik yang masuk sebelum dokumen PO resmi terbit.

2. **Dashboard Lapangan (`project-epi`):**
   - Rute aktif: `src/routes/(app)/workshop/+page.svelte` (Tahap F0–F5: Order Baru, Material Siap, Blasting/Coating, QC/Inspeksi, Selesai, Serah Terima).
   - Log pelapisan: `src/routes/(app)/proyek/[project_id]/coating-log/` (Traceability batch lot cat & DFT).
   - Surat Jalan & Scanner: Universal scanner `src/routes/scan/[code]/+page.svelte` sudah siap menangani token Surat Jalan, validasi pos gerbang/satpam (`kiosk/gerbang-sj`), dan Proof of Delivery (POD) digital signature.

---

## 2. Skema Solusi Kasus Spesifik

### Kasus A: 10 Pcs Pipa dengan PO, Ambil 5 Pcs Terlebih Dahulu (Partial Delivery)

#### Alur Bisnis & Aturan Sistem (SOP Gate)
1. **Penerimaan & Tiket Kerja:**
   - 10 pcs pipa terdaftar di bawah 1 Work Ticket / SPK Workshop yang terikat ke Sales Order / PO Customer.
   - Sistem membangkitkan 10 baris item granular (`ciketing_work_ticket_item` #1 s/d #10) dengan status proses bertahap: Sandblasting → Primer → Second (Intermediate) → Topcoat → QC Pass.
2. **Kondisi Selesai Sebagian:**
   - Misal pipa #1 s/d #5 telah melewati QC Pass (DFT sesuai spek), sedangkan pipa #6 s/d #10 masih di tahap Primer.
   - Field Leader / Mandor mengajukan **Permintaan Pengambilan (Delivery Request)** khusus untuk item #1–#5 (Qty: 5 pcs).
3. **Pemeriksaan Invoice (Finance Gate):**
   - **Pemeriksaan Otomatis:** Saat Admin Logistik hendak mencetak Surat Jalan Keluar untuk 5 pcs tersebut, sistem memicu *Gate Check*:
     - *Kondisi A1 (Invoice Per Pengiriman / Proforma):* Belum ada invoice untuk 5 pcs ini → Sistem menyediakan tombol aksi cepat `[Buat Faktur Tagihan Parsial (5 pcs)]`. Faktur dibuat berbasis 50% nilai kontrak/harga satuan item.
     - *Kondisi A2 (Termin DP / CBD):* Customer sudah membayar DP di muka yang mencukupi batas kredit pengambilan 5 pcs → Gate Status: **HIJAU (Lolos)**.
     - *Kondisi A3 (Termin Tempo / Kredit Disetujui):* Customer memiliki plafon kredit aktif → Gate Status: **HIJAU dengan Catatan Tempo**.
4. **Penerbitan Surat Jalan Parsial:**
   - Terbit Surat Jalan Keluar Workshop #1 bertanda **"PARSIAL (5 dari 10 pcs)"**.
   - Item #1 s/d #5 ditandai `is_shipped = true` dan tertaut ke ID Surat Jalan Keluar #1.
   - Work Ticket tetap berstatus `partial_complete` (Sisa 5 pcs).
5. **Penyelesaian Sisa Barang:**
   - Ketika pipa #6 s/d #10 selesai dan diambil, terbit Surat Jalan Keluar #2 bertanda **"FINAL / PELUNASAN PENGIRIMAN (5 dari 10 pcs)"** beserta tagihan sisa/pelunasan. Work Ticket otomatis ditutup (`closed`).

---

### Kasus B: 10 Pcs Pipa Masuk Tanpa PO, Mau Diambil 5 Pcs (Non-PO Handling)

> [!WARNING]
> Mengeluarkan barang hasil pengerjaan tanpa dokumen komitmen resmi (PO/Kontrak) memiliki risiko komersial tinggi (piutang macet / sengketa spesifikasi).

#### Perlakuan & Rekomendasi Alur Objektif
1. **Registrasi Barang Titipan (Custody Ticket):**
   - Pipa fisik diterima di workshop menggunakan tiket **Non-PO Entry** (`source_type: 'non_po'`).
   - Wajib melampirkan: Foto fisik kedatangan, Surat Pengantar/Tanda Terima Barang Mentah Customer, dan PIC penerima.
2. **Proses Pengerjaan:**
   - Pengerjaan sandblasting, primer, dan second coat tetap dicatat per-item agar HPP bahan (cat & abrasive) dan upah mandor tercatat akurat di workshop ledger.
3. **Protokol Ketat Pengambilan (Release Gate):**
   Ketika customer ingin mengambil 5 pcs sementara dokumen PO formal masih belum terbit dari pihak procurement customer, sistem menyediakan **3 Opsi Penanganan Objektif**:
   - **Opsi 1 (Sangat Direkomendasikan - Cash Before Delivery via Proforma Invoice):**
     Admin Finance menerbitkan **Proforma Invoice (PI)** untuk 5 pcs yang sudah selesai. Customer wajib melunasi pembayaran atau mengirimkan bukti transfer sebelum Surat Jalan Keluar dan fisik pipa dilepas dari gerbang workshop Ciketing.
   - **Opsi 2 (Surat Jaminan / PO Bayangan):**
     Jika customer adalah BUMN/Korporat rekanan lama dengan birokrasi PO lambat, sistem mewajibkan upload **Surat Konfirmasi Kerja / SPMK / LoI (Letter of Intent)** dan mendapatkan **Approval Satu Tingkat oleh Manager Finance / Direksi** pada dashboard.
   - **Opsi 3 (Hold / Penahanan Barang):**
     Sistem secara default mengunci pembuatan Surat Jalan jika PO tidak ada DAN tidak ada bukti pembayaran PI/Dispensasi Direksi. Operator lapangan dan admin tidak bisa melakukan bypass cetak SJ.
4. **Rekonsiliasi Saat PO Terbit:**
   - Ketika PO resmi akhirnya tiba, Admin cukup membuka Work Ticket tersebut dan klik tombol `[Tautkan ke PO Resmi]`. Semua riwayat Surat Jalan parsial dan Proforma Invoice otomatis dikonversi ke Sales Order dan Faktur Pajak/Invoice final tanpa input ulang.

---

## 3. Rencana Implementasi Bertahap (Fase per Fase)

### FASE 1: Fondasi Skema Data (Directus Collections & Fields)
**Fokus:** Menyiapkan struktur relasi data di Directus tanpa mengganggu data operasional yang sedang berjalan. Directus fetching dipisah per-relasi sesuai aturan global.

1. Buat collection `ciketing_work_ticket`:
   - `ticket_number` (string, unique), `source_type` (enum: `sales_order`, `non_po`), `customer_id` (m2o), `po_number` (string, nullable), `total_qty` (int), `qty_completed` (int), `qty_shipped` (int), `status` (enum: `draft`, `in_progress`, `partial_complete`, `completed`, `closed`).
2. Buat collection `ciketing_work_ticket_item`:
   - `work_ticket_id` (m2o), `item_number` (int), `label` (string, misal: "Pipa #01"), status tahapan: `stage_sandblasting`, `stage_primer`, `stage_intermediate`, `stage_topcoat`, `stage_qc` (enum: `pending`, `in_progress`, `done`, `rework`), `is_shipped` (bool), `surat_jalan_id` (m2o ke `ciketing_surat_jalan_keluar`).
3. Modifikasi collection `ciketing_surat_jalan_keluar`:
   - Tambahkan field `is_partial` (boolean), `delivery_sequence` (int), `invoice_reference_id` (m2o ke invoices), `non_po_override_by` (m2o ke directus_users).

> **Pertanyaan Kunci Fase 1:**  
> *"Apakah pencatatan 10 pcs pipa ini wajib dilacak nomor unik fisiknya satu per satu (misal barcode/label Pipa #1 s/d #10), atau cukup pencatatan agregat angka kuantitas (misal: Selesai = 5, Sisa = 5)?"*

---

### FASE 2: Modul Admin ERP Ciketing (`erp-epi`)
**Fokus:** Antarmuka pengawasan tiket kerja, split surat jalan, dan gate invoice finance.

1. **Tab Tiket Kerja Workshop:**
   - Lokasi: Menambahkan sub-fitur di `src/routes/ws-ciketing/` terhubung ke komponen baru `WsCiketingWorkTicketTab.svelte`.
   - UI menampilkan badge progres per item: visual indikator hijau/kuning untuk tahapan Sandblasting, Primer, dan Second.
2. **Wizard Pengeluaran Parsial & Pengecekan Invoice:**
   - Tombol `[Ajukan Pengambilan / SJ Keluar]`:
     - Langkah 1: Centang pipa yang sudah QC Pass (misal pilih 5 pcs).
     - Langkah 2: Evaluasi Gate Invoice. Tampil status tagihan:
       - Jika Non-PO: Muncul peringatan merah dan opsi `[Terbitkan Proforma Invoice]` atau form `[Dispensasi Manager]`.
       - Jika Ada PO: Tampil pilihan invoice parsial atau cek saldo termin pembayaran.
     - Langkah 3: Generate Surat Jalan Keluar bertanda Parsial.
3. **Panduan Visual & Hint Pengguna:**
   - Setiap form dilengkapi kotak hint biru informatif (contoh: *"Perhatian: Mengambil 5 dari 10 pcs akan menyisakan 5 item dalam status pengerjaan. Tagihan parsial disarankan langsung dibuat untuk mengamankan cashflow."*).

> **Pertanyaan Kunci Fase 2:**  
> *"Untuk tagihan 5 pcs parsial tersebut, apakah bagian Finance membuat Invoice terpisah senilai 5 pcs, atau membuat 1 Invoice senilai total 10 pcs di awal dengan status pembayaran termin/bertahap?"*

---

### FASE 3: Modul Dashboard Lapangan (`project-epi`)
**Fokus:** Kemudahan input mandor/operator tanpa beban administrasi yang rumit.

1. **Tampilan Sederhana & Ramah Sentuh (Mobile-Friendly):**
   - Lokasi: Menyempurnakan `src/routes/(app)/workshop/` agar mandor dapat langsung membuka Work Ticket terkait.
   - Fitur "1-Tap Progress Update": Mandor tinggal mengetuk nomor pipa untuk mengubah status dari Sandblasting → Primer → Second → Siap QC.
2. **Tombol Pengajuan Serah Terima Parsial:**
   - Mandor di lapangan menandai: *"Pipa #1 s/d #5 sudah diambil pihak ekspedisi/customer"*.
   - Mengambil tanda tangan driver dan foto pipa di atas bak truk langsung lewat kamera HP.
3. **Sinkronisasi Pos Satpam:**
   - Satpam gerbang pabrik menggunakan kiosk scanner (`/kiosk/gerbang-sj`) membaca QR Surat Jalan untuk memastikan truk hanya membawa keluar tepat 5 pcs pipa, bukan 10 pcs.

> **Pertanyaan Kunci Fase 3:**  
> *"Apakah verifikasi fisik saat pipa dinaikkan ke truk dilakukan langsung oleh mandor workshop, atau harus dicek ulang oleh petugas logistik/satpam di pintu gerbang?"*

---

### FASE 4: Otomasi & Notifikasi Real-time (n8n)
**Fokus:** Otomasi alur tanpa membebani server backend Directus.

1. **Workflow n8n: Invoice Gate Notifier:**
   - Ketika ada pengajuan Surat Jalan parsial di Ciketing, n8n memeriksa status PO/Invoice. Jika belum ada invoice/pembayaran, n8n otomatis mengirim alert WhatsApp/Notifikasi ERP ke tim Finance: *"Ada permintaan rilis 5 pcs pipa (Non-PO / Belum Bayar) untuk Customer X. Mohon tinjau Proforma Invoice."*
2. **Workflow n8n: Auto-Sync Qty Status:**
   - Saat Surat Jalan berstatus `delivered`/`selesai`, n8n memperbarui status sisa stok work ticket menjadi `partial_delivered` dan menghitung sisa item (5 pcs).

> **Pertanyaan Kunci Fase 4:**  
> *"Apakah notifikasi approval pengeluaran barang non-PO cukup dikirim via portal notifikasi internal ERP, atau wajib diteruskan ke WhatsApp group Finance/Manajemen?"*

---

## 4. Rekomendasi Terbaik Fitur Dashboard (Admin & Lapangan)

### A. Rekomendasi Dashboard Admin (`erp-epi` - Internal):
1. **Visual Batch Split Matrix:** Tampilan grid interaktif yang memperlihatkan posisi real-time masing-masing pipa (di area blasting, oven cat primer, curing intermediate, atau area staging siap ambil).
2. **Aging Barang Titipan Non-PO:** Widget khusus di dashboard untuk mendeteksi barang non-PO yang sudah menginap > 14 hari di Ciketing tanpa kejelasan PO, mencegah penumpukan area workshop.
3. **Simulasi HPP WIP Real-Time:** Menghitung otomatis biaya bahan baku (liter cat primer & topcoat) yang telah terpakai untuk 5 pcs yang sudah keluar vs 5 pcs yang masih dalam proses.
4. **Auto-Reconciliation Tool:** Satu klik untuk mencocokkan nomor Surat Jalan Sementara Non-PO ke dokumen PO resmi saat PO fisik akhirnya terbit.

### B. Rekomendasi Dashboard Lapangan (`project-epi` - Project/Workshop):
1. **Quick Offline QR Tagging:** Kemampuan mencetak stiker QR tahan cuaca untuk ditempel di masing-masing pipa begitu tiba di workshop, sehingga pelacakan cukup dengan scan HP.
2. **Coating Environment Logger:** Form cepat pencatatan suhu substrat (°C) dan kelembaban relatif (RH %) sebelum aplikasi primer/second coat untuk jaminan mutu inspeksi.
3. **Digital Bast Parsial (Sign-on-Screen):** Form serah terima digital di layar smartphone mandor untuk ditandatangani supir pengambil barang.

---

## 5. Panduan & Hint untuk Pengguna Lapangan & Admin

- **Hint di Layar Pengeluaran Barang:**
  > 💡 *Tips:* Pengeluaran parsial otomatis membagi nomor Surat Jalan menjadi sub-indeks (contoh: `SJ-CK-2609-0012/P1`). Pastikan nomor ini tercantum pada lembar tagihan parsial ke customer.
- **Panduan Pengendalian Barang Non-PO:**
  > ⚠️ *Penting:* Jangan pernah menyerahkan barang jadi kepada supir customer tanpa memverifikasi Kode QR Surat Jalan pada aplikasi. Jika status QR menunjukkan "Menunggu Pembayaran Proforma", arahkan supir untuk menunggu konfirmasi dari tim Finance.
