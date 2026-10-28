# Panduan Uji Manual — Paket 02 Offline & Idempotensi (Site Visit Release)

> Untuk PR [project-epi#142](https://github.com/ExploreInovativeTech/project-epi/pull/142) — sebelum di-merge oleh Lead. Semua verifikasi kode (tsc, vitest, svelte-check) sudah lolos; dokumen ini adalah bukti uji lapangan yang **wajib dilampirkan ke PR** (Aturan #10 CLAUDE.md).

## Persiapan (sekali saja)

1. **Checkout branch & jalankan dev server:**
   ```bash
   git fetch origin fix/site-visit-release-02-offline
   git checkout fix/site-visit-release-02-offline
   npm install   # kalau belum pernah di branch ini
   npm run dev   # buka http://localhost:5174
   ```
2. **HP Android + kabel USB**, atau **Chrome DevTools remote debugging** (`chrome://inspect`) supaya bisa lihat console HP dari laptop. Uji di HP asli lebih akurat daripada emulator laptop (GPS/kamera beda perilaku).
3. Login sebagai karyawan yang **punya penugasan proyek aktif** (untuk check-in tipe proyek).
4. Siap-siap 2 device/akun kalau mau uji skenario 6 (urutan check-in ganda) — boleh 1 HP + 1 laptop dengan akun sama kalau server mengizinkan sesi ganda.

**Cara simulasikan offline di Chrome DevTools:** buka tab **Network**, pilih **Offline** di dropdown throttling (bukan cuma matikan WiFi HP — DevTools Offline lebih konsisten untuk simulasi dari laptop; untuk HP asli pakai **Mode Pesawat**).

---

## Skenario 1 — Check-in & Check-out offline penuh (mode pesawat)

**Yang diuji:** worst case A, B (write-ahead + kartu "Tersimpan di HP").

1. Buka `/site-checkin` **saat online** dulu (supaya daftar proyek & settings sempat ke-cache — lihat Skenario 3).
2. Aktifkan **Mode Pesawat**.
3. Pilih proyek, ambil foto, tekan **Check-In Sekarang**.
4. **Verifikasi:**
   - [ ] Muncul kartu amber **"📱 Tersimpan di HP — sinyal lemah..."** (BUKAN error merah, BUKAN form yang hilang begitu saja).
   - [ ] Form check-in **tidak muncul lagi** setelah itu — kartu "Tersimpan di HP" yang tampil di halaman utama, bukan form kosong.
   - [ ] Tombol **Check-out Sekarang** tersedia di kartu itu.
5. Isi ringkasan kunjungan, tekan **Check-out Sekarang**.
6. **Verifikasi:**
   - [ ] Modal checkout **tidak langsung tertutup** — muncul kartu "📱 Tersimpan di HP — checkout aman tersimpan..." dulu.
   - [ ] Tutup modal manual (tombol X).
7. Matikan Mode Pesawat.
8. **Verifikasi (dalam ≤60 detik, tanpa buka halaman lagi — coba pindah ke menu lain dulu):**
   - [ ] Kartu "Tersimpan di HP" hilang dari halaman (kalau masih di `/site-checkin`) atau saat kembali ke halaman ini sudah bersih.
   - [ ] Cek Directus `site_checkin` (lewat MCP/admin): **1 baris**, `check_in_at` = jam saat check-in ditekan (bukan jam saat sinyal kembali), `check_out_at` = jam saat checkout ditekan, `client_txn_id` & `checkout_client_txn_id` terisi UUID.

---

## Skenario 2 — Request terkirim, respons hilang (retry tidak boleh duplikat)

**Yang diuji:** worst case A (server idempotensi via `client_txn_id`).

1. **Online normal.** Buka DevTools → Network.
2. Isi form check-in sampai siap kirim.
3. Tekan **Check-In**. **Segera** (dalam <1 detik, saat request `POST /api/site-checkin` masih *pending* di tab Network) → klik kanan request itu → **Block request URL**, atau langsung ganti ke **Offline**.
4. **Verifikasi:**
   - [ ] Klien menganggap ini gagal jaringan → kartu "Tersimpan di HP" muncul (bukan error permanen), karena responsnya memang tidak pernah sampai balik ke klien (walau kemungkinan server SUDAH memproses).
5. Set kembali **Online**. Tunggu ≤60 detik (auto-sync) atau reload halaman.
6. **Verifikasi:**
   - [ ] Directus `site_checkin`: **HANYA 1 baris** untuk kunjungan ini (bukan 2) — walau ada 2 "percobaan" (yang online terputus + yang dari antrean). `client_txn_id` sama, dedup server bekerja.

---

## Skenario 3 — Offline total (belum pernah buka menu ini saat online)

**Yang diuji:** worst case C (§3.11, cache `localStorage`).

**Bagian A — belum pernah ada cache:**
1. Di browser/profil BARU (atau `localStorage.clear()` lewat DevTools Console lalu reload), aktifkan Mode Pesawat SEBELUM membuka `/site-checkin`.
2. Buka `/site-checkin`.
3. **Verifikasi:**
   - [ ] Muncul pesan **"Belum Ada Sinyal & Belum Ada Daftar Tersimpan"** dengan teks awam (bukan error teknis Inggris, bukan halaman kosong/blank).

**Bagian B — sudah pernah ada cache:**
1. Matikan Mode Pesawat, buka `/site-checkin` sekali (biar Promise.allSettled berhasil dan `simpanCache` ke localStorage jalan).
2. Aktifkan lagi Mode Pesawat, reload halaman.
3. **Verifikasi:**
   - [ ] Daftar proyek **tetap muncul** (dari cache), dengan label kecil **"Daftar tersimpan di HP (tanggal, tanpa sinyal)"** di atas daftar.
   - [ ] Foto tetap wajib (default aman `foto_checkin_wajib: true` kalau settings juga gagal dimuat & tidak ada cache settings).

---

## Skenario 4 — Sinkronisasi dari menu lain (bukan hanya saat `/site-checkin` terbuka)

**Yang diuji:** worst case D (sinkronisasi global, `siteCheckinSync.ts` di root `(app)` layout).

1. Mode Pesawat → buka `/site-checkin` → check-in → "Tersimpan di HP".
2. **Pindah ke halaman LAIN** (mis. `/` beranda, atau `/ess`) — **jangan** buka `/site-checkin` lagi.
3. Matikan Mode Pesawat **sambil tetap di halaman lain itu**.
4. Tunggu ≤60 detik (tanpa aksi apa pun) ATAU pindah tab lalu kembali (memicu `visibilitychange`).
5. **Verifikasi:**
   - [ ] Buka DevTools Network — pastikan ada request `POST /api/site-checkin` terkirim **otomatis** walau user tidak pernah kembali ke `/site-checkin`.
   - [ ] Directus `site_checkin`: baris baru muncul tanpa user perlu buka halaman check-in lagi.

---

## Skenario 5 — Sinyal sangat lemah (timeout, bukan spinner tanpa akhir)

**Yang diuji:** worst case E/F (`fetchWithTimeout`).

1. DevTools → Network → **Throttling → Slow 3G**, lalu **tambahkan latency ekstra**: buka **Network conditions** (⋮ → More tools → Network conditions), custom profile dengan latency 30000+ ms.
2. Check-in seperti biasa.
3. **Verifikasi:**
   - [ ] Dalam **~30 detik** (bukan menit-menitan / selamanya), muncul kartu "Tersimpan di HP" — spinner **tidak** berputar tanpa akhir.

---

## Skenario 6 — Urutan check-in offline yang tersinkron belakangan (durasi tidak boleh salah)

**Yang diuji:** worst case G (`createCheckin` §3.10) — butuh 2 perangkat/tab dengan akun SAMA, atau simulasi manual jam.

**Cara paling praktis (1 device, simulasi via 2 sesi berurutan):**
1. **Pesawat mode** jam **08:00** (catat waktu asli) → check-in ke Proyek A. Kartu "Tersimpan di HP".
2. **Tetap offline**, biarkan HP idle **~5-10 menit** (supaya ada selisih waktu nyata antara check-in A dan check-in B).
3. **Masih offline** → buka menu Check-in Proyek Baru → check-in ke Proyek B. Ini akan otomatis (via `auto_next_checkin`) menutup A begitu tersinkron — tapi karena keduanya masih di antrean, urutan `createdAt` menentukan siapa "aktif" duluan.
4. Nyalakan sinyal. Tunggu sinkron selesai (≤60 dtk).
5. **Verifikasi di Directus `site_checkin`:**
   - [ ] Baris **A**: `status = completed`, `checkout_method = auto_next_checkin`, `check_out_at` = **jam check-in B ditekan** (bukan jam sinkronisasi selesai).
   - [ ] Baris **B**: `status = active` (atau completed kalau sudah di-checkout juga), `check_in_at` = jam B ditekan.
   - [ ] `durasi_menit` baris A masuk akal (selisih A→B), **bukan 0 dan bukan negatif**.

**Skenario replay lebih tua (lebih sulit disimulasikan manual, opsional bila ada waktu):** 2 device dengan akun sama — device 1 check-in offline jam 08:00 tapi baru online jam 10:00; device 2 check-in online normal jam 09:00 (jadi aktif). Saat device 1 akhirnya sinkron (jam 10:00, tapi `check_in_at` tetap tercatat 08:00 karena `client_created_at`), **verifikasi**: baris device 2 (09:00) **TIDAK** ikut tertutup/terganggu; baris device 1 (08:00) yang langsung ditutup ke jam 09:00 (saat device 2 mulai), dengan `catatan_sistem` berisi `replay_offline_urutan`.

---

## Skenario 7 — Checkout offline pada kunjungan yang sudah ditutup sistem

**Yang diuji:** worst case H (`closeCheckin` idempotensi §3.9.3).

1. Check-in ke Proyek A secara **online normal**.
2. **Sebelum** checkout, buat kondisi baris A tertutup otomatis: check-in ke Proyek B (online) — ini akan menutup A via `auto_next_checkin`.
3. **Sekarang**, di HP yang **beda tab/sesi** yang masih menyimpan referensi checkout ke A di antrean (simulasi: buka DevTools Application → IndexedDB → `epi_site_checkin_queue` → tambahkan manual entry checkout untuk checkin A yang sudah tertutup — **ATAU** lebih mudah: mode pesawat → checkout A dulu → **sebelum** sempat online, di tab lain check-in ke B lalu langsung online (menutup A) → baru online-kan tab pertama).
4. **Verifikasi:**
   - [ ] Antrean checkout untuk A yang tersinkron belakangan **TIDAK** menampilkan error "Check-in sudah ditutup" ke user.
   - [ ] Response server `already_closed: true`, antrean bersih (entri terhapus, bukan nyangkut selamanya).

---

## Skenario 8 — Checkout saat check-in sendiri masih di antrean

**Yang diuji:** worst case I (§3.9.2, `checkin_client_txn_id` → 425).

1. Mode Pesawat → check-in ke Proyek A → kartu "Tersimpan di HP" muncul dengan tombol **Check-out Sekarang**.
2. **Tanpa online-kan dulu**, langsung tekan **Check-out Sekarang** di kartu itu.
3. **Verifikasi:**
   - [ ] Modal checkout terbuka normal (bukan error "checkin_id wajib diisi").
   - [ ] Isi & submit checkout (masih offline) → kartu "Tersimpan di HP" untuk checkout juga muncul.
4. Nyalakan sinyal, tunggu sinkron.
5. **Verifikasi Directus:**
   - [ ] `site_checkin` baris A: `status = completed`, `check_out_at` terisi wajar.
   - [ ] **Tidak ada** baris duplikat, tidak ada error 425 yang "nyangkut" (kalau lihat log server, boleh ada 1-2 percobaan 425 sebelum check-in A benar-benar tersinkron — itu NORMAL, bukan bug, selama akhirnya berhasil).

---

## Setelah semua skenario lolos

- [ ] Screenshot/log tiap skenario (minimal kartu "Tersimpan di HP" yang muncul + hasil query Directus) — lampirkan ke PR #142.
- [ ] Uji regresi cepat: buka salah satu antrean LAIN yang TIDAK disentuh paket ini (mis. `/ess/absen` — antrean absensi) dan pastikan masih berperilaku sama seperti sebelumnya (offline → tersimpan → auto-flush saat online). Ini membuktikan opsi baru `ordered`/`isRetryable` di factory benar-benar tidak mengubah 22 antrean lain.
- [ ] Update deskripsi PR #142 dengan hasil (lolos semua / ada yang gagal + detail).
- [ ] **Jangan merge sendiri** — tunggu approval Lead (@Lynssee / @joeeltama-oss) sesuai Aturan Git & PR Gate.
