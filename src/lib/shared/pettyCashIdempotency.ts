// src/lib/shared/pettyCashIdempotency.ts
// PC3-19 — salinan TS dari erp-epi `src/lib/server/pettyCashIdempotency.js` (kunci idempoten tiket, logika MURNI).
// JAGA IDENTIK: tes kontrak (pettyCashIdempotency.test.ts) memakai tabel harapan yang sama di kedua repo.

/** Kunci dari klien → string ≤ 64 karakter, atau null bila kosong. */
export function normalizeTxnId(v: unknown): string | null {
	const s = String(v ?? '').trim().slice(0, 64);
	return s || null;
}

/** Apakah error unik Directus berasal dari kolom client_txn_id (bukan request_number)? */
export function isClientTxnConflict(err: any): boolean {
	const isUnique = err?.code === 'RECORD_NOT_UNIQUE' || /unique|duplicate/i.test(err?.message || '');
	if (!isUnique) return false;
	return err?.field === 'client_txn_id' || /client_txn_id/i.test(err?.message || '');
}
