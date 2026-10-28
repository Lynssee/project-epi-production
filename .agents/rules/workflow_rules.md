# Workflow & Development Rules

1. **Direct & Concise**: Selalu to the point, ringkas, tanpa basa-basi atau bertele-tele.
2. **Objektif & Kritis**: Jika sebuah ide atau pendekatan tidak sesuai/tidak efektif, bersikap objektif: katakan "tidak perlu" secara tegas dan berikan alternatif yang lebih baik demi kepentingan stabilitas aplikasi.
3. **Branch Major**: Seluruh pekerjaan dijalankan di branch `Major` (atau branch fitur berbasis `Major`). DILARANG direct commit/push ke branch `main`.
4. **Hanya Inspect & Modifikasi `src/routes/`**: Fokus hanya pada folder `src/routes/` yang relevan dengan tugas. Abaikan folder besar atau file yang tidak ada hubungannya untuk menghemat context dan token.
5. **Minimalisir Hardcode & UI Configurable**:
   - Semua opsi, parameter, dan konfigurasi non-sensitif WAJIB bisa diatur melalui UI interface oleh user / Superadmin.
   - Hanya konfigurasi sensitif (API key, token, kredensial, URL backend privat) yang tetap berada di `.env`.
6. **Efisiensi Resource & Hemat API Usage**:
   - Minimalkan API call yang tidak perlu (gunakan in-memory cache, batch request, atau batasi fetching berulang).
   - Buat seefisien mungkin dalam mengambil resource agar server tidak terbebani (hindari full scan / over-fetching).
   - Maksimalkan penggunaan package bawaan/terpasang yang ada; jika sebuah package baru dinilai memberatkan, dilarang dipakai.
7. **Pengembangan Bertahap (Phased Development)**:
   - Bagi pengerjaan menjadi beberapa **fase bertahap** terstruktur untuk meminimalisir bug.
   - Prioritaskan kehati-hatian dan kode yang bug-free daripada terburu-buru.
   - Di setiap akhir fase, **tanyakan satu pertanyaan kunci** sebelum lanjut ke fase berikutnya.
8. **User Interface Ramah Pengguna (User-Friendly)**:
   - Pastikan posisi UI berada di lokasi yang sesuai, rapi, intuitif, dan mudah diakses oleh user.
   - Cantumkan **hint, label, tooltip, atau panduan singkat** untuk membantu user memahami langkah/fitur tersebut.
9. **Lifecycle & Gate System**:
   - Jika terdapat mekanisme gate/blocking/validasi alur, pastikan gate tersebut terdaftar di lifecycle sistem dan dapat dikonfigurasi/di-toggle via UI oleh Superadmin.
10. **Pengujian E2E**:
    - Pengujian end-to-end (e2e) dilakukan belakangan setelah seluruh fase implementasi selesai.
11. **Pemilihan Model**: Jangan pernah eksekusi menggunakan model Opus dan Sonnet.
