# Changelog — Project EPI Production

Seluruh perubahan dan riwayat integrasi dari repository hulu (`project-epi`) ke dalam `project-epi-production`.

---

## [2026.11.23] — Sinkronisasi Modul Hulu (`8665e5d7..0eabfb7d`) & Stabilisasi Produksi

Sinkronisasi **31 commit non-merge** dari hulu `project-epi` (`8665e5d7` s/d `0eabfb7d`, 586 file: 307 baru, 279 modifikasi) di atas `origin/main` produksi (`a9633029` / `f11cb24f` Kiosk hitung fisik & barang baru) pada branch `sync/upstream-2026-11-20`.

### 🚀 Fitur Baru & Peningkatan Modul (Migrasi 7 Fase)

#### 1. Core Config, Shared Engines & 3-Way Overlap (Fase 1)
- **Konfigurasi & Iframe ERP**: Penambahan `--max-old-space-size=8192` pada script `check` (`package.json`), pembaruan `frame-ancestors` (`svelte.config.js`), dan pelonggaran `X-Frame-Options` khusus `/panduan` & `?preview=1` (`src/hooks.server.ts`).
- **Shared & Utils**: Pembaruan utilitas inti (`paktaPolicy`, `paktaGateChanges`, `cultureModel`, `cultureMoment`, `culturePopupClient`, `kendaliHarian`, `tutupBulan`, `kebutuhanCat`, `dewPoint`, `rejectWasteBanner`, `rekapTim`, `learningPath`, `quizPeriodic`, `ojtAssessment`, `rndJalur`, `sertifikatKartu`, `offlineTrainingCache`, `bukuSakuOfflineCache`, `wipPolicy`, `plApd`/`plKit`/`plSet`/`plConfidence`/`plStaged`).
- **Resolusi 3 File Overlap Produksi**: Penggabungan bersih `siteCheckin.ts`, `SpkTtdLinkModal.svelte` (Svelte 5 runes + JSDoc + `window.__showToast`), dan `ProjectManpowerAssign.svelte` (`onclose`/`onchanged` tanpa duplikasi event).

#### 2. Panduan, SOP, Bantuan Kontekstual, Pencarian & QR Checkpoint (Fase 2)
- **Hierarki & BPMN Alur**: `FieldHierarchyCard.svelte`, `fieldHierarchyConfig.ts`, bentuk BPMN 2.0 di `FlowMiniMap.svelte`, `ProcessInfographicFlow.svelte`, `ProcessVisualInstructionCards.svelte`, `NegativeScenariosPanel.svelte`, `SopKnowledgeCard.svelte`.
- **SOP & Bantuan**: Filter tags/domain SOP (`/api/sop`), Quick Tag Pills (`/bantuan`), `SopSayaWidget.svelte`, `PanduanKerjaDropdown.svelte`, `ProjectSopNotesCard.svelte`, Contextual Help Floating Assist (`HelpMenuButton.svelte`), Universal Search 4-in-1 (`universalHelpSearch.ts`), upgrade `/api/search` (`fieldNavExtras.ts`, `knowledgeSearch.ts`).
- **Scan QR Checkpoint**: Dukungan kode mentah, prefix label, dan URL (`checkpointScanRoute.ts` + `/api/ga-checklist/checkpoint/{resolve,verify}`).

#### 3. Packing List (APD/Kit/Set), Stok Lapangan, Kalkulator Cat & Inventory 360 (Fase 3)
- **Packing List**: `PlApdCard.svelte`, `PlKitCard.svelte`, `PlSetCard.svelte` + endpoint `/api/packing-list/{apd-basics,kit-basics,set-rules}`.
- **Stok Lapangan & Kalkulator Cat**: Halaman baru `/inventory-proyek/kalkulator-cat`, integrasi sesi opname proyek & kalkulator kaleng cat limbah B3 (`SOP-PRJ-320` & `SOP-LOG-015` di `/stock-lapangan/opname-sesi`), dan `/api/inventory-proyek/idle-config`.
- **Inventory 360**: Sinkronisasi `inventoryKnowledgeDefaults.js` dengan kontrak `erp-epi` (`0eabfb7d`).

#### 4. Equipment Hub, Preventive (P2H PDF & PM Selesai), Maintenance & Kiosk Standby (Fase 4)
- **Equipment Hub**: `EquipmentHub.svelte`, `equipmentHubCore.ts`, `/api/equipment/hub/[id]` & `/api/equipment/resolve-item`.
- **Preventive & Maintenance**: Export PDF P2H (`/api/preventive/p2h/export-pdf`), peningkatan `/api/preventive/pm/selesai`, penomoran WO (`woNumber.ts`), dan guard lapor WO (`woLaporGuard.ts`).
- **Kiosk Standby**: `KioskStandby.svelte`, `kioskStandby.ts`, `/api/kiosk/standby`, `/api/kiosk/culture-banner` (tetap melestarikan 100% fitur Kiosk produksi `f29064a5` & `f11cb24f`).

#### 5. Leader, Proyek, Pelaporan, WIP/Jurnal & Manpower K3 (Fase 5)
- **Halaman Baru**: `/leader/kpi-saya`, `/proyek/[project_id]/tutup-bulan`, `/laporan-saya`, `/manpower/rekap-tim`.
- **Komponen & Engine**: `KendaliHarianCard.svelte`, `CustomerKpiBadge.svelte`, `KpiProyekHarianWidget.svelte`, `KelengkapanProyekSayaWidget.svelte`, `ProyeksiPenyelesaianCard.svelte`, `TargetProyeksiWidget.svelte`, `ManpowerK3Chip.svelte` (`/api/manpower-k3`), `journalWriter.ts` & `wipSettings.ts`.

#### 6. R&D, Produksi, Driver, Sales & Strategy Radar (Fase 6)
- **Strategy Radar**: `PosisiLiniCard.svelte`, `RadarChip.svelte`, `/api/strategy/posisi-lini`.
- **R&D, Produksi, Driver & Sales**: Tab lapangan R&D + kalkulator Dew Point (`/rnd`), `SpkDataHealthBanner.svelte` (`/api/produksi/data-health`), ambang reject/waste (`/api/produksi/ambang-reject-waste`), skor performa driver (`/api/driver/score`), dan `SalesScoreCard.svelte`.

#### 7. ESS Lengkap & Global Layout Guards (Fase 7)
- **Halaman Baru ESS**: `/ess/budaya`, `/ess/jobdesc`, `/ess/referral`, `/ess/pelatihan/ojt`, `/ess/pelatihan/jalur-karier`, `/ess/pelatihan/sertifikat`.
- **Pelatihan, Budaya, DISC, KPI & Pakta**: Micro-quiz harian & kontekstual, OJT, jalur karier R&D, sertifikat branding, offline training cache, kesehatan & pembinaan tim, profil gaya kerja DISC (`/ess/kinerja` & `/regu`), budaya/motivasi/belonging/golden rules, serta Pakta Integritas pra-kegiatan.
- **Global Layout (`src/routes/(app)/+layout.svelte`)**: Pemasangan `PaktaGuard` (bawaan nonaktif & fail-open), `PaktaSayaMenu`, `CulturePopupHost` (fail-soft), `QuizGateHost` (fail-open), dan `HelpMenuButton` topbar.

---

### 🛠️ Stabilisasi & Perbaikan Bug Produksi (Fase 8)

- **Fix Runtime Crash `SopKnowledgeCard.svelte`**: Menambahkan validasi `Array.isArray(parsed.quizzes)` dan optional chaining `data?.quizzes?.find(...)` untuk mencegah `TypeError: Cannot read properties of undefined (reading 'find')` saat payload tidak memuat `quizzes`.
- **Fix Rune Shadowing `MicroQuizCard.svelte`**: Mengganti nama variabel `state` menjadi `quizState` agar tidak bertabrakan dengan rune `$state` pada compiler/checker Svelte 5.
- **Null-Safety & Strict Typing**:
  - `src/routes/scan/[code]/+page.svelte`: optional chaining `epiParsed?.type` pada handler tombol stok.
  - `src/lib/services/equipmentVerify.ts`: menambahkan properti opsional `hub` pada `VehicleVerifyResult` & `ToolVerifyResult`.
  - `src/routes/api/search/knowledgeSearch.ts`, `PlSetCard.svelte`, dan `kalkulator-cat/+page.svelte`: pelengkapan anotasi tipe ketat TypeScript.
- **Pelestarian Produksi**: 0 regresi pada fitur Kiosk opname/hitung fisik/barang baru (`f29064a5`, `f11cb24f`), port produksi (`5174` / Directus `9390`), dan file sampah hulu `edit-tmp.mjs` dikecualikan.

---

### 📋 Catatan Kesiapan Backend & Lingkungan

- **Directus**: 38/38 koleksi baru yang dibutuhkan modul hulu sudah terverifikasi tersedia di Directus.
- **Relay `ERP_EPI1_BASE_URL` (8 endpoint)**: `/api/automation/customer-kpi-badge`, `/api/kpi/finance-impact/saya`, `/api/kpi/target-saya`, `/api/hrd/manpower-k3`, `/api/project/health-mine`, `/api/project/completeness`, `/api/reports/event`, dan `/api/reports/stats` belum tersedia di `erp-epi-production` saat ini; seluruh proxy di repo ini sudah diverifikasi fail-soft/terkendali dan akan otomatis terisi penuh setelah `erp-epi-production` disinkronkan.
- **Env Var Opsional**: `DOKUMEN_VERIFIKASI_HMAC_SECRET`, `AUTOMATION_SERVER_SECRET`, `TRAINING_CERT_VERIFY_SECRET`, dan `MICROQUIZ_ATTEMPT_SECRET` dapat ditambahkan ke `.env` produksi untuk mengaktifkan verifikasi tanda tangan HMAC & jembatan otomasi penuh.

---

### 🧪 Hasil Verifikasi Kode & Build

- **Suite Kiosk Produksi**: 6/6 file unit test (48/48 test) + `RakDetailPanel.dom.test.ts` (13/13 test) lulus 100%.
- **DOM Tests (`vitest.dom.config.ts`)**: `field-hierarchy.dom.test.ts` lulus setelah fix `SopKnowledgeCard.svelte`; 48/50 file DOM test lulus (2 file DOM lama `/panduan/alur` hanya mengalami drift teks assertion dari hulu).
- **Production Build (`npm run build`)**: Lolos 100% tanpa error (bundle SSR & Client, PWA service worker, dan output `@sveltejs/adapter-node`).

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
