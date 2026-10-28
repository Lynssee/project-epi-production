// src/lib/utils/fetchWithTimeout.ts
// Paket 02 Site Visit Release (docs/(analyst) site visit/02_offline-idempotensi.md §3.1) —
// fetch tanpa batas waktu (SVR-25) membuat spinner tampil selamanya di sinyal sangat
// lemah, bukannya masuk antrean offline. Timeout memaksa error retryable (AbortError)
// dalam waktu wajar supaya alur write-ahead di form bisa mengambil alih.

export async function fetchWithTimeout(
	input: RequestInfo | URL,
	init: RequestInit = {},
	ms = 30_000
): Promise<Response> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), ms);
	try {
		return await fetch(input, { ...init, signal: ctrl.signal });
	} finally {
		clearTimeout(timer);
	}
}
