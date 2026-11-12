# Changelog — Project EPI Production

Seluruh perubahan dan riwayat integrasi dari repository hulu (`project-epi`) ke dalam `project-epi-production`.

---

## [2026.11.12] — Sinkronisasi Mayor Modul Hulu (Phases 1-9) & Stabilisasi Build Produksi

### 🚀 Fitur Baru & Peningkatan Modul (Migrasi 9 Fase)

#### 1. Core Utilities & Domain Engines (Fase 1)
- **Project Risk Engine (`src/lib/server/projectRiskEngine.ts`)**: Mesin kalkulasi otomatis risiko proyek berbasis skor keterlambatan jadwal, pembengkakan biaya, deviasi kualitas coating/DFT, dan kedisiplinan tim lapangan.
- **Critical Path Method (`src/lib/server/criticalPath.ts`)**: Algoritma CPM untuk visualisasi dan kalkulasi jalur kritis pada jadwal proyek / Gantt chart.
- **Dossier Readiness (`src/lib/server/dossierReadiness.ts`)**: Mesin verifikasi kelengkapan dokumen pra-konstruksi, FAT, SAT, dan serah terima proyek.
- **Weather Assist (`src/lib/server/weatherAssist.ts`)**: Integrasi prakiraan cuaca otomatis di lokasi koordinat proyek untuk panduan keselamatan dan kelayakan pekerjaan blasting/painting.
- **Kompresi Foto Darurat (`src/lib/utils/photoCompress.ts`)**: Penambahan fungsi `computeTargetSize` dan `compressPhotoEmergency` untuk kompresi adaptif di area minim sinyal.
- **Offline Queue Resilient (`src/lib/utils/offlineQueueFactory.ts`)**: Penambahan mekanisme antrean offline terstandar dengan dedup dan retry exponential backoff.
- **Perhitungan Kontrak Borongan (`src/lib/utils/boronganNilai.ts`)**: Validasi dan kalkulasi ambang batas harga borongan.

#### 2. Pos Satpam & Manajemen Kunci Gate G_SEC8 (Fase 2)
- **Antarmuka Pos Satpam Kunci (`src/routes/(app)/satpam/kunci/+page.svelte`)**: Dashboard pencatatan peminjaman dan pengembalian kunci operasional gudang, bengkel, dan armada.
- **Service & Gate Kunci (`src/lib/server/keyService.ts`, `src/lib/server/gates/securityKeyGate.ts`)**: Enforce gate `G_SEC8` yang mencegah penutupan hari sebelum seluruh kunci inventaris dikembalikan ke pos keamanan.

#### 3. Manpower TBM Roll-call, Anti-Kabur & Tautan TTD SPK (Fase 3)
- **TBM Roll-call Lapangan (`src/routes/(app)/tbm-rollcall/+page.svelte`)**: Roster pencatatan kehadiran Toolbox Meeting (safety induction) harian sebelum jam kerja dimulai.
- **TTD SPK Mandor via Tautan (`src/routes/(app)/spk/ttd/+page.svelte`)**: Halaman publik tanda tangan SPK digital ramah HP dengan verifikasi OTP WhatsApp, kiosk Project Leader, serta varian pakta integritas tanpa harga untuk kru.
- **Modal Link SPK (`src/lib/components/project/SpkTtdLinkModal.svelte`)**: Komponen admin untuk membuat tautan tanda tangan, membuka mode kiosk, atau mengaktifkan dispensasi bertanda tangan.
- **Pelaporan Manpower Mangkir/Kabur (`src/lib/components/project/LaporKaburModal.svelte`)**: Fitur pelaporan mandor/pekerja mangkir fatal dengan pemotongan kasbon, sanksi blacklist instan, dan broadcast peringatan.
- **Absensi Regu Massal (`src/routes/(app)/proyek/[id]/absen-regu/+page.svelte`)**: Pencatatan kehadiran massal kru proyek berbasis validasi geofence koordinat proyek.

#### 4. Disiplin FDCI Site Leader, Preview KPI & Tutup Kunjungan (Fase 4)
- **Leader Daily Discipline Card (`src/lib/components/leader/LeaderDailyDisciplineCard.svelte`)**: Kartu monitoring harian kepatuhan Project Leader terhadap ritme kerja (check-in, TBM, inspeksi harian, tutup kunjungan).
- **Early Warning System (EWS) Kinerja (`src/lib/components/leader/LeaderKpiEarlyWarningBanner.svelte`)**: Peringatan dini sanksi aktif divisi (SP, karantina SLA, pembekuan anggaran) dengan caching fail-soft 60 detik.
- **Auto/Manual Tutup Kunjungan (`src/lib/server/visitLeaderTutup.ts`)**: Penutupan kunjungan otomatis berbasis laporan harian atau penutupan manual terkoordinat.

#### 5. Serah Terima Peralatan, Mobile PM & Verifikasi QR (Fase 5)
- **Mobile PM Workflow (`src/routes/(app)/preventive/pm-next/+page.svelte`)**: Alur checklist preventive maintenance peralatan lapangan yang dioptimasi untuk perangkat mobile.
- **Core Verifikasi Alat (`src/lib/services/equipmentVerifyCore.ts`)**: Logika verifikasi status alat, audit QR code fisik, dan integrasi riwayat servis berkala.

#### 6. AI Process Guidance & Stage Navigator (Fase 6)
- **Lembar Panduan AI Lapangan (`src/lib/components/shared/FieldAiGuidanceSheet.svelte`)**: Asisten AI kontekstual untuk memberikan rekomendasi SOP kerja dan tindakan preventif di lapangan.
- **AI Navigator Komponen (`src/lib/components/ai/ai-navigator/`)**: Navigasi tahapan proses pekerjaan lapangan terpandu.

#### 7. Kesiapan Proyek, Spesifikasi Teknis & Deviasi DFT (Fase 7)
- **Spesifikasi Teknis Lapangan (`src/routes/(app)/proyek/[id]/spesifikasi-teknis/+page.svelte`)**: Modul verifikasi parameter teknis (blasting profile, salt test, paint thickness).
- **Mesin Deviasi DFT (`src/lib/server/dftDeviation.ts`)**: Analisis deviasi ketebalan cat kering terhadap standar toleransi SSPC/ISO.
- **Endpoint Kesiapan Berkas (`/api/proyek/[project_id]/dossier-readiness`)**: API endpoint untuk rekapitulasi kesiapan dokumen serah terima proyek.

#### 8. Cetak Site Cost Statement & Resolusi Lacak Publik (Fase 8)
- **Cetak Lembar Biaya Proyek A4 (`src/routes/(app)/proyek/[id]/rap-aktual/cetak/+page.svelte`)**: Format cetak standar PDF/print A4 untuk perbandingan RAP vs Biaya Aktual proyek.
- **Pembaruan Tracking Publik (`/lacak/[token]`)**: Resolusi status pengiriman dan progres aktual untuk klien eksternal.

#### 9. Penguatan Berkas Eksisting & Alur Bisnis (Fase 9)
- **Grand PO Nol Rupiah**: Dukungan pembuatan dan verifikasi transaksi Sub Grand PO non-komersial/zero rupiah.
- **Cutoff Mingguan Pengajuan Anggaran (PA)**: Validasi batas waktu mingguan pengajuan anggaran dan kalkulasi SLA birokrasi lapangan.
- **Peta Alur Bisnis Dokumentasi (`docs/peta_alur_bisnis_kpi_management_dan_kedisiplinan_proyek.md`)**: Dokumentasi alur tata kelola KPI dan kepatuhan operasional proyek.

---

### 🛠️ Stabilisasi, Perbaikan Bug & Kompatibilitas Build

- **Perbaikan Struktur Blok `src/lib/server/siteCheckin.ts`**: Menambahkan penutupan blok `else` pada fungsi `createCheckin` yang menyebabkan kegagalan kompilasi AST pada upstream.
- **Koreksi Penamaan Ikon `@tabler/icons-svelte`**:
  - Mengganti impor subpath `@tabler/icons-svelte/icons/shield-alert` menjadi `shield-exclamation` pada `LeaderKpiEarlyWarningBanner.svelte`.
  - Mengganti impor `IconShieldAlert` menjadi `IconShieldExclamation as IconShieldAlert` pada `LaporKaburModal.svelte`.
- **Migrasi Komponen Svelte 5 Runes `SpkTtdLinkModal.svelte`**:
  - Mengganti sintaks legacy `export let` ke rune `$props()`.
  - Mengonversi state lokal ke rune `$state()`.
  - Menyelaraskan seluruh event listener ke standar Svelte 5 (`onclick`, `onfocus`).
  - Mengganti ketergantungan `svelte-sonner` yang tidak terpasang dengan helper toast bawaan aplikasi (`window.__showToast`).
- **Penyelarasan Standar Ekspor Endpoint SvelteKit**:
  - `src/routes/api/preventive/foto-telemetri/+server.ts`: Mengubah nama helper ekspor `ringkasAgen` menjadi `_ringkasAgen` (beserta update pada `telemetri.test.ts`) sesuai spesifikasi analisis SvelteKit.
  - `src/routes/api/preventive/p2h/terbuka/+server.ts`: Menghapus kata kunci `export` pada konstanta lokal `GATE_SESI_LAMA`.
- **Pelestarian Konfigurasi Khusus Produksi**:
  - Mempertahankan penyesuaian opname rak gudang (`adjustOpnameRak`) dari commit `f29064a5` (`kioskGudang.ts`, `kioskStok.ts`, `src/routes/kiosk/cek-stok/[gudang_id]/+page.svelte`).
  - Menjaga konfigurasi port produksi (`5174` untuk frontend, `9390` untuk Directus ERP backend).

---

### 🧪 Hasil Verifikasi Build & Pengujian

- **Unit & Logic Tests**: Seluruh uji unit Vitest (`*.test.ts`) dan DOM test (`*.dom.test.ts`) berhasil dijalankan.
- **Production Build (`npm run build`)**: Lolos 100% tanpa error, 8.255 modul berhasil ditransformasikan, bundle SSR dan Client terekam rapi di `.svelte-kit/output`, service worker PWA terkompilasi, dan output disiapkan untuk deployment melalui `@sveltejs/adapter-node`.
