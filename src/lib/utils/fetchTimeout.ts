// src/lib/utils/fetchTimeout.ts
// fetch dengan batas waktu (Peminjaman 07 §3.1). Tanpa ini, di jaringan 2G spinner "Mengirim…" bisa
// berputar berminggu-menit tanpa informasi. Melempar Error bertanda `isNetwork` (dan `isTimeout`) supaya
// UI bisa membedakan "server menolak" (ada respons HTTP) vs "jaringan lambat/putus" (tidak ada respons —
// hasil kirim BELUM PASTI, jadi pengiriman ulang harus idempoten lewat client_txn_id).

export type NetworkError = Error & { isNetwork: true; isTimeout?: boolean };

/** Batas waktu default: 30 dtk untuk GET, 60 dtk untuk POST/PATCH/PUT/DELETE (termasuk upload). */
export function defaultTimeoutMs(method?: string): number {
	const m = (method || 'GET').toUpperCase();
	return m === 'GET' || m === 'HEAD' ? 30_000 : 60_000;
}

export function isNetworkError(e: unknown): e is NetworkError {
	return !!e && typeof e === 'object' && (e as { isNetwork?: boolean }).isNetwork === true;
}

export async function fetchWithTimeout(
	input: RequestInfo | URL,
	init: RequestInit = {},
	ms: number = defaultTimeoutMs(init.method)
): Promise<Response> {
	try {
		return await fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(ms) });
	} catch (e: any) {
		const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
		const err = new Error(
			timedOut ? 'Koneksi lambat — server belum menjawab.' : 'Tidak ada koneksi internet.'
		) as NetworkError;
		err.isNetwork = true;
		if (timedOut) err.isTimeout = true;
		throw err;
	}
}
