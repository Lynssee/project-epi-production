// src/lib/server/fleetKode.ts
// Peminjaman 12 §2 — kode booking `BK-YYMMDD-XXXXX`: tanggal WIB + 5 karakter acak dari alfabet tanpa huruf ambigu
// (0/O/1/I). Kapasitas ±33 juta/hari. Format lama `BK-YYMMDD-NNN` (3 digit) punya peluang tabrakan ±38% untuk 30 booking/hari
// dan memakai jam server/browser (booking 00:00–07:00 WIB di server UTC berkode tanggal kemarin).
//
// ⚠ WAJIB sama dengan erp-epi `src/lib/utils/fleetKode.js` — ubah keduanya bersamaan (repo terpisah, duplikasi disengaja).

const ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 32 karakter → b % 32 tanpa bias

/** yymmdd berdasarkan WIB (disusun dari formatToParts — tidak bergantung urutan/format locale). */
export function tanggalWib(now: Date = new Date()): string {
	const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: '2-digit', month: '2-digit', day: '2-digit' }).formatToParts(now);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	return `${get('year')}${get('month')}${get('day')}`;
}

export function genKodeBooking(now: Date = new Date()): string {
	const buf = new Uint8Array(5);
	globalThis.crypto.getRandomValues(buf);
	let s = '';
	for (const b of buf) s += ALPHA[b % ALPHA.length];
	return `BK-${tanggalWib(now)}-${s}`;
}

export const POLA_KODE_BOOKING = /^BK-\d{6}-[2-9A-HJ-NP-Z]{5}(-\d+)?$/;

/** Error Directus karena nilai unik bertabrakan (kode_booking kembar setelah kolom dibuat unique). */
export function isKodeCollision(e: unknown): boolean {
	const msg = String((e as { message?: string })?.message ?? e ?? '');
	return /RECORD_NOT_UNIQUE|unique|duplicate|UNIQUE constraint/i.test(msg);
}
