// src/lib/utils/networkError.ts
// Paket 02 Site Visit Release (docs/(analyst) site visit/02_offline-idempotensi.md §3.1) —
// klasifikasi error jaringan/server sementara (layak diantrekan & diulang) vs error
// permanen (bukan masalah jaringan, tidak akan hilang dengan mengulang). Dipakai
// offlineSiteCheckinQueue.ts + siteCheckinSync.ts + form check-in/checkout supaya
// keputusan "antrekan vs tampilkan error" konsisten di satu tempat, bukan regex
// TypeError yang tersebar (SVR-01 lama).

export class HttpError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'HttpError';
		this.status = status;
	}
}

/** true = layak diantrekan/diulang (masalah jaringan/server sementara, bukan salah data). */
export function isRetryableError(err: unknown): boolean {
	if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
	if (err instanceof HttpError) {
		// 425 (Too Early) dipakai checkout server untuk "check-in pasangan belum sampai" (§3.9.2)
		// — retryable karena akan beres begitu antrean check-in terkirim lebih dulu. 409 SENGAJA
		// tidak dimasukkan di sini: 409 dipakai untuk konflik permanen (mis. data ditolak), bukan
		// "belum siap, coba lagi".
		return [408, 425, 429, 500, 502, 503, 504].includes(err.status);
	}
	const e = err as { name?: string; code?: string; message?: string } | null | undefined;
	if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return true; // fetchWithTimeout
	if (e?.code === 'auth/network-request-failed') return true; // Firebase offline
	if (err instanceof TypeError) {
		return /failed to fetch|networkerror|load failed|network request failed/i.test(e?.message || '');
	}
	return false;
}

/** Pesan manusiawi untuk orang awam — tidak pernah menampilkan istilah Firebase/teknis mentah. */
export function pesanErrorAwam(err: unknown): string {
	if (isRetryableError(err)) {
		return 'Sinyal sedang lemah. Data Anda aman tersimpan di HP dan akan terkirim otomatis.';
	}
	const msg = (err as Error)?.message || '';
	return msg && !/firebase|auth\//i.test(msg) ? msg : 'Terjadi kendala. Coba lagi, atau hubungi admin bila berulang.';
}
