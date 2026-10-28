// src/lib/utils/dispensasiAlasan.ts
// Validasi MURNI alasan permintaan dispensasi gate (cermin MIN_ALASAN di erp-epi gateDispensasi.js; server tetap otoritas).
export const MIN_ALASAN = 20;

export function validateAlasan(alasan: string): string | null {
	const t = (alasan || '').trim();
	return t.length >= MIN_ALASAN ? null : `Jelaskan alasannya minimal ${MIN_ALASAN} karakter (sekarang ${t.length}).`;
}
