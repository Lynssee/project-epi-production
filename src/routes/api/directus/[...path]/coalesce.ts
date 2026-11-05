// src/routes/api/directus/[...path]/coalesce.ts
// In-flight request coalescing untuk GET proxy Directus lapangan.
//
// Masalah: satu halaman sering memicu beberapa komponen yang memanggil GET identik
// (employees, projects, app_settings, ...) di milidetik yang sama; proxy ini tidak punya
// cache, jadi tiap pemanggil menembak Directus sendiri (thundering herd, ~180 ms/round-trip).
// Solusi: pemanggil ke-2..n menumpang Promise pemanggil pertama dan menerima salinan
// hasil yang sama. TIDAK ada cache setelah selesai -- begitu request pertama kelar,
// entri dihapus, jadi data tidak pernah lebih basi dari satu round-trip.
//
// Aman karena kuncinya adalah URL upstream FINAL (setelah scope per-user disuntik ke
// query), sehingga dua user dengan scope berbeda otomatis punya kunci berbeda.

export interface BufferedUpstream {
	status: number;
	headers: [string, string][];
	body: Uint8Array | null; // null untuk status tanpa body (204/205/304)
}

const NULL_BODY = new Set([204, 205, 304]);
const KEEP_HEADERS = ['content-type', 'content-disposition', 'cache-control'];

const inflight = new Map<string, Promise<BufferedUpstream>>();

/** Baca Response upstream sekali jadi buffer yang boleh dibagi ke banyak pemanggil. */
export async function bufferUpstream(res: Response): Promise<BufferedUpstream> {
	const headers: [string, string][] = [];
	for (const name of KEEP_HEADERS) {
		const v = res.headers.get(name);
		if (v) headers.push([name, v]);
	}
	const body = NULL_BODY.has(res.status) ? null : new Uint8Array(await res.arrayBuffer());
	return { status: res.status, headers, body };
}

/** Bangun Response baru (body & headers independen) dari hasil buffer. */
export function toResponse(b: BufferedUpstream): Response {
	// slice() -> salinan, supaya konsumen yang memodifikasi buffer tak memengaruhi pemanggil lain
	return new Response(b.body ? b.body.slice() : null, { status: b.status, headers: new Headers(b.headers) });
}

/**
 * Jalankan `run` untuk kunci ini, atau tumpang pada yang sedang berjalan.
 * Bila request pemimpin gagal (throw), semua penumpang ikut menerima error yang sama.
 */
export async function coalesced(
	key: string,
	run: () => Promise<Response>
): Promise<{ response: Response; coalesced: boolean }> {
	const running = inflight.get(key);
	if (running) return { response: toResponse(await running), coalesced: true };

	const promise = run()
		.then(bufferUpstream)
		.finally(() => {
			if (inflight.get(key) === promise) inflight.delete(key);
		});
	inflight.set(key, promise);
	return { response: toResponse(await promise), coalesced: false };
}

/**
 * Putus penumpang baru dari request yang sudah berjalan untuk koleksi ini -- dipanggil saat ada
 * tulis (POST/PATCH/PUT/DELETE), supaya GET sesudah tulis tidak menumpang hasil yang dimulai
 * SEBELUM tulis (read-your-writes).
 */
export function dropInflight(path: string): void {
	const needle = String(path || '').split('/').slice(0, 2).join('/').toLowerCase();
	if (!needle) {
		inflight.clear();
		return;
	}
	for (const key of inflight.keys()) {
		if (key.toLowerCase().includes(needle)) inflight.delete(key);
	}
}

/** Hanya untuk tes. */
export function _inflightSize(): number {
	return inflight.size;
}
