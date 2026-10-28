// Aturan Anti-Kesalahan #5 (CLAUDE.md): DILARANG `await` sebelum `window.open()` — browser (terutama Safari iOS) menganggap
// pemanggilan setelah operasi async bukan aksi user dan memblokirnya sebagai pop-up.
// Pola aman: buka jendela KOSONG secara sinkron di handler klik, lalu arahkan ke URL setelah data siap.
//
//   const w = openPlaceholderWindow();        // SINKRON, sebelum await apa pun
//   const url = await buatUrl();
//   w.navigate(url);                          // atau w.cancel() bila gagal

export interface PlaceholderWindow {
	/** Arahkan jendela ke URL. Bila pop-up benar-benar diblokir, jatuh ke tab yang sama. */
	navigate(url: string, opts?: { revokeAfterMs?: number }): void;
	/** Tutup jendela kosong (gagal / tidak ada yang dibuka). */
	cancel(): void;
}

export function openPlaceholderWindow(): PlaceholderWindow {
	const win = typeof window !== 'undefined' ? window.open('', '_blank') : null;
	return {
		navigate(url, opts) {
			if (win && !win.closed) win.location.href = url;
			else if (typeof location !== 'undefined') location.href = url;
			if (url.startsWith('blob:')) {
				const ms = opts?.revokeAfterMs ?? 60_000;
				setTimeout(() => URL.revokeObjectURL(url), ms);
			}
		},
		cancel() {
			try {
				win?.close();
			} catch {
				/* abaikan */
			}
		}
	};
}
