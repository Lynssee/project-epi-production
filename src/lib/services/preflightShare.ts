// src/lib/services/preflightShare.ts
// Berbagi panggilan preflight yang SEDANG BERJALAN untuk body identik. TIDAK menyimpan hasil (bukan cache): begitu
// panggilan selesai, panggilan berikutnya selalu ke server -- jadi "Cek Ulang" setelah memperbaiki data tidak pernah
// mendapat hasil basi. Menghemat panggilan ganda saat pemicu bertumpuk (debounce otomatis + kembali ke tab + tombol).
const inflight = new Map<string, Promise<any>>();

/** Jalankan `run` sekali per `key` selama masih berjalan; pemanggil lain menunggu hasil yang sama. */
export function shareInflight<T>(key: string, run: () => Promise<T>): Promise<T> {
	const hit = inflight.get(key);
	if (hit) return hit as Promise<T>;
	const p = run().finally(() => {
		if (inflight.get(key) === p) inflight.delete(key);
	});
	inflight.set(key, p);
	return p;
}

/** Hanya untuk uji. */
export function _inflightSize() {
	return inflight.size;
}
