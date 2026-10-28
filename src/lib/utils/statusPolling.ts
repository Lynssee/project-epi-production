// src/lib/utils/statusPolling.ts
// Fase 6 (open-source plan) — "status approval real-time" tanpa WebSocket asli.
// WebSocket langsung Directus dari browser TIDAK viable di app ini: client tidak
// pernah pegang token/URL Directus asli (selalu lewat proxy server + sesi Firebase,
// lihat $lib/services/directus.ts) — membuka WS asli berarti mint token Directus
// baru per sesi, permukaan keamanan baru yang belum disetujui. Sebagai gantinya:
// re-fetch status saat tab kembali fokus/online + interval berkala — "live-ish",
// cukup untuk kebanyakan kasus, nol perubahan arsitektur.

export interface StatusPollingOptions {
	/** Interval polling berkala (ms). Default 60 detik. */
	intervalMs?: number;
}

/**
 * Daftarkan re-fetch otomatis: saat tab kembali fokus, saat koneksi online lagi,
 * dan tiap `intervalMs`. Kembalikan fungsi cleanup — panggil di onDestroy.
 * @param refetch fungsi yang mengambil ulang data (JANGAN tampilkan spinner full-halaman di sini — background refresh harus senyap)
 */
export function registerStatusPolling(refetch: () => void | Promise<void>, opts: StatusPollingOptions = {}): () => void {
	if (typeof window === 'undefined') return () => {};
	const intervalMs = opts.intervalMs ?? 60_000;

	const onVisible = () => {
		if (document.visibilityState === 'visible') refetch();
	};
	const onFocusOrOnline = () => refetch();

	document.addEventListener('visibilitychange', onVisible);
	window.addEventListener('online', onFocusOrOnline);
	window.addEventListener('focus', onFocusOrOnline);
	const timer = window.setInterval(refetch, intervalMs);

	return () => {
		document.removeEventListener('visibilitychange', onVisible);
		window.removeEventListener('online', onFocusOrOnline);
		window.removeEventListener('focus', onFocusOrOnline);
		window.clearInterval(timer);
	};
}
