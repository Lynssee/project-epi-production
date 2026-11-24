// src/lib/server/ess/attendanceLock.ts
// In-memory single-flight lock per (aksi, karyawanId, tanggal) untuk mencegah
// race condition double/triple row di absensi_harian ketika user mengetuk kirim
// berulang atau me-retry saat jaringan/Directus lambat.

const activeLocks = new Map<string, Promise<unknown>>();

export function attendanceLockKey(
	action: 'clock_in' | 'clock_out' | 'break_in' | 'break_out',
	karyawanId: number | string,
	tanggal: string
): string {
	return `${action}:${karyawanId}:${tanggal}`;
}

/**
 * Jalankan `fn` secara eksklusif untuk `key`. Request paralel kedua dengan kunci identik
 * menumpang Promise request pertama (single-flight idempotensi) — tidak pernah menjalankan
 * upload foto / penulisan Directus ganda secara bersamaan.
 *
 * PENTING: `fn` harus mengembalikan data plain object (bukan SvelteKit Response),
 * supaya setiap request pemanggil membangun `json(result)` sendiri-sendiri.
 */
export function withAttendanceLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const existing = activeLocks.get(key) as Promise<T> | undefined;
	if (existing) return existing;

	const pending = Promise.resolve()
		.then(fn)
		.finally(() => {
			if (activeLocks.get(key) === pending) activeLocks.delete(key);
		});
	activeLocks.set(key, pending);
	return pending;
}

/** Untuk tes: cek jumlah kunci aktif / bersihkan state. */
export function _activeAttendanceLockCount(): number {
	return activeLocks.size;
}

