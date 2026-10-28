# Audit: Duplikat Nomor Pengajuan Anggaran (PA-0303)

**Tanggal audit:** 10 Sep 2026
**Pemicu:** Review daftar Pengajuan Anggaran di Pusat Pengajuan — dua baris berbeda tampil dengan nomor `PA-0303` yang sama.
**Status:** ✅ DIPERBAIKI 10 Sep 2026 (kode + data + schema). Lihat §8 untuk log eksekusi.

## 1. Bukti Data

Query `pengajuan_anggaran` filter `nomor_pengajuan = 'PA-0303'`:

| id | nomor_pengajuan | pengaju | department | project_id | tujuan_pengajuan | total_amount | date_created |
|---|---|---|---|---|---|---|---|
| 732 | PA-0303 | IRFAN AULIA SUHADA | PROJECT | 897 | Kasbok proyek borongan | 15.000.000 | 2026-09-09T09:42:53.964Z |
| 733 | PA-0303 | IRSYAD ABDI PRATAMA | PROJECT | 710 | KASBON MP (AGUNG) | 300.000 | 2026-09-09T09:43:13.006Z |

Dua baris berbeda (id, project, pengaju, nominal semua beda), dibuat **19 detik** berselisih, dengan nomor identik.

Sweep agregat seluruh koleksi (`groupBy nomor_pengajuan`, semua baris ber-`nomor_pengajuan`) mengonfirmasi **hanya `PA-0303` yang punya count > 1** — jadi ini kejadian tunggal sejauh ini, bukan wabah, tapi bug-nya struktural (lihat §3) sehingga bisa terulang kapan saja ada 2 submission lapangan yang nyaris bersamaan.

## 2. Temuan Kedua: Dua Skema Nomor Berjalan Paralel

Sweep yang sama juga menunjukkan dua format nomor **aktif bersamaan di bulan yang sama (Sep 2026)**:

- **`PA-NNNN` (polos, tanpa tahun/bulan)** — rentang `PA-0006` s/d `PA-0304`. Baris-baris terbaru (`PA-0290`–`PA-0304`, dibuat 7–10 Sep 2026) **semua** berasal dari department `PROJECT` dan pengaju: Irfan Aulia Suhada, Irsyad Abdi Pratama, Ridho Akbar Sagradi, Julianto, Muhammad Taufik Anhar — pola submission dari **Dashboard Lapangan** (`project-epi`).
- **`PA-YYMM-NNNN`** — rentang `PA-2606-0001` s/d `PA-2609-0044`. Ini format yang dihasilkan [`generatePengajuanAnggaranNumber()`](../src/lib/services/budgetRequestApi.js#L351) di repo ini (erp-epi). Dipakai submission dari HRD, Finance, IT, Inventory, Marketing & Sales, dan sebagian PROJECT (mis. Putri Handayani — admin yang menginput atas nama proyek).

**Kesimpulan:** `pengajuan_anggaran.nomor_pengajuan` diisi oleh **dua generator independen di dua repo berbeda** (erp-epi "Dashboard Admin" dan project-epi "Dashboard Lapangan") yang menulis ke koleksi Directus yang sama tanpa saling koordinasi. Selain bikin nomor tidak konsisten (menyulitkan pencarian/sortir/rekonsiliasi manual), ini menggandakan permukaan risiko tabrakan karena ada 2 sequence terpisah yang keduanya bisa collide dengan dirinya sendiri.

## 3. Root Cause Teknis (di sisi erp-epi)

`generatePengajuanAnggaranNumber()` — [`src/lib/services/budgetRequestApi.js:351-377`](../src/lib/services/budgetRequestApi.js#L351-L377):

```js
export async function generatePengajuanAnggaranNumber() {
    const now = new Date();
    const prefix = `PA-${yy}${mm}`;
    const res = await df(`/items/pengajuan_anggaran?filter[nomor_pengajuan][_starts_with]=${prefix}&fields=nomor_pengajuan&limit=-1`);
    let maxSeq = 0;
    // ... hitung maxSeq dari hasil query ...
    return `${prefix}-${String(maxSeq + 1).padStart(4, '0')}`;
}
```

Ini pola **read-then-write non-atomik** ("baca nomor tertinggi, +1, lalu simpan"), tanpa transaction/lock di level Directus maupun aplikasi. Kalau dua request submit datang hampir bersamaan (khas kondisi lapangan: beberapa staf proyek submit kasbon/borongan di jam yang sama), keduanya bisa membaca `maxSeq` yang sama **sebelum** salah satu commit ke database — hasilnya dua nomor identik. Pola generator yang sama (bare sequence, kemungkinan besar tanpa prefix tahun-bulan) diduga dipakai juga di `project-epi` untuk skema `PA-NNNN` — **perlu diverifikasi langsung di repo project-epi** (di luar akses sesi audit ini).

**Faktor yang memperparah — tidak ada unique constraint:**

Cek skema field langsung ke Directus:

```json
"schema": {
  "name": "nomor_pengajuan",
  "data_type": "varchar",
  "is_nullable": true,
  "is_unique": false,
  "is_indexed": false
}
```

Karena kolom tidak `unique`, Directus tidak menolak insert kedua — race condition di atas lolos mulus tanpa error apa pun ke pengguna. Ini juga berarti masalah **tidak akan pernah ketahuan otomatis** — hanya terlihat kalau ada yang membandingkan daftar secara manual (seperti temuan user kali ini).

## 4. Dampak / Risiko

- **Finance/AP**: `nomor_pengajuan` dipakai sebagai `reference_number` di `purchase_invoices`/`payables` (lihat `budgetRequestApi.js` — banyak titik pakai `pengajuan.nomor_pengajuan` sebagai kunci pencarian pembayaran, mis. `syncPengajuanPaymentStatus()`). Dua PA dengan nomor sama bisa membuat pencairan/pelunasan salah tertaut ke PA yang keliru (melanggar semangat Aturan #8 CLAUDE.md — idempoten & balance jurnal).
- **Pencarian & audit**: staf yang mencari "PA-0303" di Pusat Pengajuan akan menemukan 2 hasil tanpa penanda jelas mana yang mana kecuali membuka detail satu-satu.
- **UX pelaporan**: dua format nomor berbeda (polos vs YYMM) di kolom yang sama membingungkan sortir/filter dan bikin nomor tidak informatif sebagai referensi periode.

## 5. Rekomendasi Perbaikan (bertahap, sesuai kebiasaan proyek — Fase kecil + tanya sebelum lanjut)

**Fase 1 — Stop pendarahan (tanpa migrasi data, aman-retroaktif):**
1. Tambahkan **unique constraint** di Directus untuk `pengajuan_anggaran.nomor_pengajuan` (index unik) — najis-nol biaya, langsung mencegah duplikat baru sejak diaktifkan.
2. Ubah `generatePengajuanAnggaranNumber()` jadi atomik: pakai retry-on-conflict (coba insert, kalau kena unique-violation, re-generate nomor & retry) — pola standar mengatasi race condition tanpa perlu DB transaction native di Directus.

**Fase 2 — Satukan sumber nomor lintas dua dashboard:**
3. Pastikan `project-epi` (Dashboard Lapangan) memanggil **generator yang sama** (idealnya via satu endpoint server bersama, mirip `api/doc-number/allocate` yang sudah ada untuk dokumen lain) alih-alih punya logic sendiri — supaya hanya ada **satu** sequence per periode, bukan dua yang berjalan paralel.
4. Standarkan SEMUA nomor baru ke format `PA-YYMM-NNNN` (format polos `PA-NNNN` dihentikan untuk PA baru; data lama dibiarkan apa adanya — tidak retroaktif, sesuai Aturan #3 CLAUDE.md).

**Fase 3 — Bereskan PA-0303 yang sudah telanjur duplikat:**
5. Beri nomor baru untuk salah satu (rekomendasi: id 733 / Irsyad, karena dibuat lebih belakangan) — **butuh keputusan Lead** karena PA ini sudah tampil di layar approval dan mungkin sudah direferensi user lain di WA/laporan manual.

## 6. Yang Belum Bisa Diverifikasi dari Sesi Ini

- Kode generator nomor di **project-epi** (Dashboard Lapangan) — repo terpisah, tidak ter-mount di working directory sesi audit ini (`C:\dev\erp-epi`). Perlu sesi terpisah dengan akses ke `project-epi` untuk konfirmasi persis mekanisme generatornya.
- Arti pasti badge **"⚠️Gate" / "🔒Ditahan" / "Incomplete"** yang tampil di screenshot — pola label ini **tidak ditemukan** di kode `pusat-pengajuan/+page.svelte` (erp-epi), yang hanya menghasilkan label "X gate wajib gagal"/"X peringatan"/"Semua gate lolos". Screenshot kemungkinan besar berasal dari UI **project-epi**, yang perlu dicek terpisah.

## 7. Pertanyaan untuk Lead (@Lynssee)

1. ~~Setuju unique constraint + retry-atomik di Fase 1 langsung dikerjakan?~~ — **Sudah dieksekusi 10 Sep 2026**, lihat §8.
2. ~~Untuk PA-0303 yang sudah duplikat: renomor sekarang atau tunggu?~~ — **Sudah direnomor 10 Sep 2026**, lihat §8.
3. ~~Fase 2 (satukan generator lintas `erp-epi` ↔ `project-epi`)~~ — **Sudah dikerjakan 10 Sep 2026**, lihat §9. Ternyata repo `project-epi` bisa diakses langsung (`C:\dev\project-epi`), tidak perlu sesi terpisah.
4. **Masih terbuka (temuan sampingan, di luar cakupan "nomor duplikat")**: `project-epi/src/lib/services/manpowerPayroll.ts::createPengajuanForPayrollRun()` membuat baris `pengajuan_anggaran` TANPA mengisi `nomor_pengajuan` sama sekali. Berpotensi baris dengan nomor kosong/null di Pusat Pengajuan. Perlu diverifikasi & diperbaiki di sesi terpisah.
5. ~~Gap penegakan gate lintas repo~~ — **Ditemukan & diperbaiki 10 Sep 2026**, lihat §10. **Keputusan Lead masih dibutuhkan**: apakah 171 PA Pending lama (yang `interlocking_status`-nya NULL) perlu di-backfill evaluasi sekarang, atau dibiarkan (lihat §10, poin risiko).

## 10. Temuan & Perbaikan Baru: Gap Penegakan Gate Jalur Lapangan (10 Sep 2026)

**Ditemukan saat mengecek "masalah gate dan data yang perlu dilengkapi"** di seluruh 376 PA berstatus Pending:

| interlocking_status | Jumlah | % |
|---|---|---|
| `null` (belum pernah dievaluasi) | 171 | 45% |
| `blocked` (gate WAJIB gagal) | 123 | 33% |
| `incomplete` (peringatan SEMI) | 60 | 16% |
| `held` (proyek di-hold, G_TERSANDERA) | 7 | 2% |
| `complete` (bersih) | 16 | 4% |

**Root cause**: `project-epi` (Dashboard Lapangan) tidak pernah memanggil `evaluateInterlockingGates()` (atau setara) setelah membuat `pengajuan_anggaran` — hanya `erp-epi` (submit admin, edit approver, atau buka Gate Wizard manual di drawer) yang melakukannya. Dari 171 baris `null`, **128 berasal dari jalur lapangan** (format nomor polos `PA-NNNN`), sisanya (43) adalah PA admin lama dari sebelum sistem gate dibangun.

**Dampak nyata**: [`paApprovalGate.js:38-40`](../src/lib/server/gates/paApprovalGate.js#L38) membaca `interlocking_gates` kosong/null sebagai "tidak ada gate WAJIB gagal" (fail-open):
```js
const gates = Array.isArray(pengajuan.interlocking_gates) ? pengajuan.interlocking_gates : [];
const failedWajib = gates.filter((g) => g?.severity === 'WAJIB' && g?.status === 'failed');
if (failedWajib.length === 0) return; // lolos
```
Artinya **seluruh PA dari Dashboard Lapangan lolos approval tanpa penegakan gate WAJIB apa pun** (G1-G20), kecuali seseorang kebetulan membuka Gate Wizard secara manual. Bukti konkret: PA-0306 dan PA-0295 (keduanya `interlocking_status: null`) punya item belanja tanpa kode akun (COA) — pelanggaran G4 yang seharusnya diblokir.

**Backlog nyata**: `blocked` tertua adalah `PA-2607-0052`, dibuat 13 Juli 2026 — hampir 2 bulan tanpa tindak lanjut.

### Perbaikan yang dieksekusi
**[project-epi PR #31](https://github.com/ExploreInovativeTech/project-epi/pull/31)** (commit tambahan di branch yang sama): `createPengajuanAnggaran()` di `finance.ts` sekarang memanggil ulang proxy `/api/pengajuan-preflight` yang SUDAH ADA (mode `{pengajuan_id}`, bukan mode pre-flight tanpa id) setelah record & item tersimpan, lalu PATCH hasilnya (`interlocking_status`, `interlocking_gates`, `threshold_tier`, `budget_check_result`, `kategori_belanja`) balik ke record — pola identik `evaluateInterlockingGates()` di erp-epi. Best-effort, tidak menggagalkan pengajuan bila gagal.

### Yang SENGAJA tidak disentuh — butuh keputusan Lead
**171 PA Pending lama yang sudah telanjur `null` TIDAK di-backfill** di sesi ini. Alasan: mengevaluasi ulang gate untuk PA lama secara massal berisiko memicu Aturan #3 CLAUDE.md (anti-lockdown retroaktif) — bisa jadi banyak dari 171 PA itu langsung berubah status jadi `blocked` begitu dievaluasi (karena data lama belum tentu lengkap sesuai standar gate saat ini), melumpuhkan operasional yang sedang berjalan. Pilihan untuk Lead:
- **Opsi A**: biarkan apa adanya, fix ini hanya berlaku untuk PA BARU ke depan (default paling aman, tidak retroaktif).
- **Opsi B**: backfill evaluasi untuk 128 PA lapangan yang `null`, tapi HANYA tulis snapshot (`interlocking_status`/`interlocking_gates`) tanpa mengubah status persetujuan — approver jadi punya visibilitas gate meski belum ada penguncian baru.
- **Opsi C**: backfill + aktifkan penguncian penuh sekaligus — paling ketat, paling berisiko melumpuhkan 123 PA `blocked` yang sudah lama menunggu.

## 9. Log Eksekusi Fase 2 (10 Sep 2026) — Unifikasi Generator project-epi

**[project-epi PR #31](https://github.com/ExploreInovativeTech/project-epi/pull/31)**, branch `fix/pa-nomor-pengajuan-race`:

- Ditemukan: `generatePengajuanAnggaranNumber()` di `project-epi/src/lib/services/finance.ts:105-133` memakai pola read-then-write identik dengan versi erp-epi, TAPI dengan prefix `PA` polos (bukan `PA-{yy}{mm}`) — inilah sumber format `PA-NNNN` (PA-0290, PA-0303, dst.) yang berbeda dari skema erp-epi. Hanya 1 pemanggil (`createPengajuanAnggaran()`, tanpa argumen custom prefix), jadi aman diubah tanpa breaking caller lain.
- Fix: format disamakan jadi `PA-YYMM-NNNN` + pre-check/retry-jitter yang sama seperti fix erp-epi (§8.A). Juga ditambah retry-on-unique-violation di `createPengajuanAnggaran()` supaya race yang lolos sampai ke `createItem()` (dan kena unique constraint Directus yang sudah dipasang §8.C) pulih sendiri dengan nomor baru, bukan melempar error mentah ke user lapangan.
- Karena keduanya sekarang memakai prefix `PA-{yy}{mm}` yang sama, kedua app menghitung sequence di **satu ruang lingkup bulanan yang sama** — tidak ada lagi dua skema nomor berjalan paralel untuk PA baru. Data lama (bare `PA-NNNN` s/d PA-0305) dibiarkan apa adanya (tidak retroaktif).
- Status: **draft PR**, belum diuji end-to-end di Dashboard Lapangan, menunggu approval Lead.

## 8. Log Eksekusi Perbaikan (10 Sep 2026)

**A. Fix kode (race-window mitigation) — [erp-epi PR #81](https://github.com/ExploreInovativeTech/erp-epi/pull/81), branch `fix/pa-nomor-pengajuan-race`:**
- `generatePengajuanAnggaranNumber()`: tambah pre-check + retry-jitter tepat sebelum nomor dipakai.
- `submitPengajuanAnggaran()`: verifikasi pasca-create + self-heal (auto-renomor) kalau tetap bentrok.
- Status: **draft PR**, belum di-test di `localhost:9391`, belum di-merge (menunggu approval Lead sesuai aturan PR gate).

**B. Perbaikan data live — dieksekusi langsung ke Directus produksi:**
- Id **733** (Irsyad Abdi Pratama, KASBON MP AGUNG, project_id 710) direnomor dari `PA-0303` → **`PA-0305`** (nomor bebas berikutnya di skema polos; id **732**/Irfan yang commit lebih dulu tetap `PA-0303`).
- Dicek dulu: tidak ada baris `master_pengajuan`, `approval_requests`, maupun `purchase_invoices` yang sudah mereferensikan pengajuan ini by id/nomor — jadi renomor ini **tidak meninggalkan referensi patah** di koleksi lain.
- Verifikasi pasca-patch: query ulang `PA-0303`/`PA-0305` — masing-masing sekarang tepat 1 baris.

**C. Perbaikan schema — Directus `pengajuan_anggaran.nomor_pengajuan`:**
- `is_unique` diubah dari `false` → **`true`** (dipasang setelah data bersih di langkah B, supaya tidak gagal karena constraint violation).
- Efek: submission baru dengan nomor yang sudah dipakai sekarang akan **ditolak Directus** di level database — lapis pertahanan terakhir yang tidak bergantung pada kode aplikasi mana pun (erp-epi maupun project-epi) berperilaku benar.
- **Catatan penting untuk Fase 2**: karena constraint ini sekarang aktif, kalau `project-epi` submit dengan nomor yang kebetulan sama dengan nomor yang baru dipakai `erp-epi` (atau sebaliknya), submission itu akan **gagal dengan error dari Directus** alih-alih diam-diam terduplikasi. Ini lebih aman (tidak ada duplikat baru) tapi berarti Fase 2 (satukan generator) jadi lebih mendesak — kalau tidak, user lapangan bisa mengalami "gagal submit" tanpa pesan error yang jelas saat race terjadi. PR #81 sudah menutup risiko ini di sisi erp-epi (retry otomatis kalau kena bentrok), tapi project-epi belum tentu punya penanganan serupa.
