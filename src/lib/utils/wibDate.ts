// src/lib/utils/wibDate.ts
// WIB (Asia/Jakarta, UTC+7, tanpa DST) tidak selalu sama dengan zona waktu device
// maupun UTC — dua bug berbeda yang ditemukan di audit P2H/checklist peminjaman:
// `new Date().toISOString()` (UTC) melenceng dari kalender WIB tiap hari (worst case
// ~7 jam), dan `new Date().getTimezoneOffset()` (lokal device) salah kalau HP
// operator tidak di-set ke Asia/Jakarta. Pakai fungsi di sini untuk semua tanggal
// "hari ini" yang menentukan status bolong/tidak bolong checklist.

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Tanggal WIB hari ini, format YYYY-MM-DD, independen dari zona waktu device. */
export function todayWib(): string {
	return new Date(Date.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/** Timestamp ISO UTC asli (untuk field jam-isi) — pakai ini, bukan todayWib(), saat perlu presisi waktu. */
export function nowIso(): string {
	return new Date().toISOString();
}

/** Konversi timestamp apa pun ke tanggal WIB (YYYY-MM-DD) — untuk membandingkan "hari kerja" data lama. */
export function toWibDateString(isoOrDate: string | Date): string {
	const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
	return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}
