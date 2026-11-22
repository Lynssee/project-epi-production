// Deklarasi tipe lokal untuk @tabler/icons-svelte.
// Paket v3.43.0 menyatakan `"types": "./dist/tabler-icons-svelte.d.ts"` tetapi berkas itu TIDAK ikut terpasang di dist/
// (hanya ada dist/icons/*.svelte.d.ts per ikon) → TS7016 "Could not find a declaration file" di setiap halaman yang
// mengimpor ikon (±428 error svelte-check). Deklarasi singkat ini menjadikan impor bernama bertipe `any` (komponen ikon Svelte).
// Berkas ini TANPA import/export di level atas sehingga dibaca sebagai deklarasi ambient. Hapus bila paket sudah menyertakan tipenya.
declare module '@tabler/icons-svelte';

// Impor langsung per ikon (`@tabler/icons-svelte/icons/<nama>`): berkas tipenya ada di dist/icons/*.svelte.d.ts lewat `exports`,
// tetapi resolusi modul proyek ini tidak membaca `exports` → TS2307. Wildcard ambient menutupnya (tipe `any`, sama seperti di atas).
declare module '@tabler/icons-svelte/icons/*';
