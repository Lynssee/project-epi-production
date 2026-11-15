// src/lib/shared/boronganNilai.ts
// PDP-40 — validasi nilai SPK borongan di form penugasan lapangan. MURNI. Kembar erp-epi
// (src/lib/data/boronganBatas.js::nilaiSpkRiil) — jaga keduanya tetap sama.
// Nilai di bawah minimum (mis. Rp1) hanyalah placeholder dan tidak bisa dipakai sebagai batas pembayaran PA.

export const NILAI_BORONGAN_MIN_DEFAULT = 100_000;

export const rupiahBorongan = (n: number): string => `Rp${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;

export function nilaiBoronganRiil(nilai: unknown, min: number = NILAI_BORONGAN_MIN_DEFAULT): boolean {
	const n = Number(nilai);
	return Number.isFinite(n) && n >= min;
}

/** Pesan galat untuk form, atau null bila nilai sudah riil. */
export function pesanNilaiBorongan(nilai: unknown, min: number = NILAI_BORONGAN_MIN_DEFAULT): string | null {
	if (nilai === '' || nilai == null || Number(nilai) === 0) return 'Isi nilai borongan';
	if (!nilaiBoronganRiil(nilai, min)) {
		return `Nilai borongan harus nilai kontrak SPK yang sebenarnya (minimal ${rupiahBorongan(min)}). Angka sementara seperti Rp1 tidak diterima — batas pembayaran PA borongan dihitung dari nilai ini.`;
	}
	return null;
}
