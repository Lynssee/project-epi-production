// Body PATCH bersyarat (CAS / "UPDATE ... WHERE") ke Directus: batch-by-query { query: { filter }, data }.
//
// ⚠️ Bentuk lama `PATCH /items/<koleksi>?filter[...]=...` + body objek polos DITOLAK Directus prod dengan
// 400 "data is required" (terverifikasi 17 Okt 2026) — fiturnya tidak pernah berhasil. Respons bentuk valid:
// `{ data: [...baris ter-update] }`; array kosong = tidak ada baris cocok (kalah race / status sudah berubah).
// Dipakai: gerbang SJ, kiosk muat SJ, kiosk gudang. Contoh lain yang setara: ciketingKioskStock.casPatchStok.

export type DirectusFilter = Record<string, unknown>;

/** Bangun body JSON untuk `PATCH /items/<koleksi>` (tanpa query-string). `fields: ['id']` menjaga respons ringan. */
export function casPatchBody(conditions: DirectusFilter[], data: Record<string, unknown>): string {
	if (!conditions.length) throw new Error('casPatchBody: minimal satu kondisi filter (tanpa filter = update SEMUA baris).');
	return JSON.stringify({ query: { filter: { _and: conditions }, fields: ['id'] }, data });
}
