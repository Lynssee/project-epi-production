# Konteks Project

- **Dashboard Lapangan:** repo ini (`project-epi`) → `project.eltamaprimaindo.com`
- **Dashboard Admin (internal):** `erp-epi-1` (repo terpisah, lihat `C:\...\Downloads\erpi-epi\erp-epi-1`) → `internal.eltamaprimaindo.com`
- **Stack:** SvelteKit, Directus, n8n (sudah terhubung). Tanpa Supabase.

## Instruksi Umum

- Analisa terlebih dahulu dari Directus, Svelte, n8n, dan infrastruktur lainnya. Cek jika belum terhubung.
- Langsung to the point, tanpa basa-basi.
- Minimalisir hardcode — semua konfigurasi non-sensitif bisa diatur via UI.
- Yang sensitif (token, URL backend) tetap di env.
- Hemat API usage — minimalkan call yang tidak perlu.
- Buat seefisien mungkin dalam mengambil resource agar server tidak berat.
- Buat dalam beberapa **fase bertahap** untuk minimalisir bug.
- Di setiap akhir fase, tanyakan satu pertanyaan kunci sebelum lanjut.
- Prioritaskan hati-hati dan bug-free daripada cepat.
- Maksimalkan penggunaan package. Jika memberatkan, tidak perlu.
- Berikan juga rekomendasi terbaik untuk fitur dashboard admin dan lapangan, tidak terbatas pada yang disebutkan.
