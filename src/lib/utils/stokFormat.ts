// src/lib/utils/stokFormat.ts
// Parse & format `identitas_barang.stok_tersedia` (varchar) dengan aman. Data lama di kolom ini
// bercampur format: "12", "4.0", "0,25" (koma desimal), "45.70". `parseFloat` biasa membaca
// "0,25" sebagai 0 dan "1,5" sebagai 1 -- salah dan bikin CAS (compare-and-swap) gagal terus
// untuk barang berformat koma. JANGAN ubah salah satu sisi (project-epi ini / erp-epi
// src/lib/utils/stokFormat.js) tanpa mengubah yang lain -- keduanya harus selalu sepakat.
//
// File 05, Perbaikan Kiosk × Produksi & Inventory (29 Sep 2026).

/** Parse stok_tersedia (varchar) dengan aman: dukung koma desimal data lama. */
export function parseStok(raw: unknown): number {
	if (raw === null || raw === undefined || raw === '') return 0;
	const s = String(raw).trim();
	// Kalau ada titik DAN koma sekaligus ("1.234,5"), jangan ditebak -- biarkan Number()
	// aslinya yang menentukan (kemungkinan besar jadi NaN -> 0), skrip normalisasi menandai
	// baris ini untuk dicek manual, JANGAN diubah otomatis di sini.
	const norm = s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s;
	const n = Number(norm);
	return Number.isFinite(n) ? n : 0;
}

/** Format tulis kanonik: maks 4 desimal, tanpa trailing zero, titik desimal. */
export function formatStok(n: number): string {
	return String(Math.round(n * 10000) / 10000);
}
