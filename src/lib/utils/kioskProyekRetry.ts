// src/lib/utils/kioskProyekRetry.ts
// Aturan murni "kirim ulang tanpa memotret ulang" untuk kiosk proyek (perbaikan kecil pasca-Fase 6).
// Prinsip: payload yang sama (foto terkompres + lokasi) hanya dikirim ulang bila kegagalannya BUKAN soal isi.

/**
 * true = layak diulang dengan payload yang SAMA: tidak ada respons (jaringan putus / sinyal lemah), 5xx, 408, 429.
 * false = server menilai isinya (400/401/403/404/409/413/422/423 …): mengulang yang sama pasti gagal lagi dan
 * kru harus mengubah sesuatu (mis. foto ganda, di luar jam, melebihi stok) — jadi kembali ke awal.
 */
export function bisaDiulang(status: number | null | undefined): boolean {
	if (status == null || status === 0) return true;
	return status >= 500 || status === 429 || status === 408;
}

/** Lokasi lama tidak dipakai ulang tanpa batas: orang bisa berpindah saat menunggu sinyal. */
export const LOKASI_MAKS_UMUR_MS = 3 * 60 * 1000;

export function lokasiMasihSegar(diambilPada: number | null | undefined, sekarang = Date.now(), maks = LOKASI_MAKS_UMUR_MS): boolean {
	if (diambilPada == null || !Number.isFinite(diambilPada)) return false;
	const umur = sekarang - diambilPada;
	return umur >= 0 && umur <= maks;
}

/** Id transaksi acak untuk satu percobaan kirim (tetap sama selama isi tidak berubah) — dipakai server membuang duplikat. */
export function buatTxnId(): string {
	try {
		if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	} catch {
		/* konteks tidak aman: pakai cadangan */
	}
	return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Hanya id yang bentuknya wajar yang diterima server (huruf/angka/strip, 8–64). */
export function txnIdValid(v: unknown): v is string {
	return typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v);
}
