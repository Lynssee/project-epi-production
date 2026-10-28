// src/lib/services/paSnapshotRetry.ts
// MURNI (tanpa import Directus/Firebase). Pembungkus retry untuk penulisan snapshot gate PA dari Dashboard Lapangan.
// Port dari erp-epi src/lib/services/paSnapshotRetry.js.
//
// Latar (audit hidden cost #1051, 20 Okt 2026): PA-2610-0166 dari lapangan masuk antrean approval tanpa snapshot
// gate (interlocking_status/gates/threshold_tier kosong) karena evaluasi pasca-create best-effort dan kegagalannya
// hanya `console.warn` di browser — penyebabnya hilang dan pengaju tidak diberi tahu. Produksi: ±300 PA Pending
// tanpa current_stage. Retry sekali menutup kegagalan sesaat; kegagalan tetap dilaporkan (audit + peringatan).

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface RetryResult<T> {
	ok: boolean;
	attempts: number;
	result?: T;
	error?: Error;
}

/** Jalankan `fn` (async) dengan retry. Tidak pernah melempar — pemanggil memutuskan. */
export async function runWithRetry<T>(
	fn: () => Promise<T>,
	{ retries = 1, delayMs = 1500, sleep = defaultSleep }: { retries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<RetryResult<T>> {
	let lastError: Error | undefined;
	const max = Math.max(0, retries) + 1;
	for (let attempt = 1; attempt <= max; attempt++) {
		try {
			const result = await fn();
			return { ok: true, attempts: attempt, result };
		} catch (e) {
			lastError = e instanceof Error ? e : new Error(String(e));
			if (attempt < max) await sleep(delayMs);
		}
	}
	return { ok: false, attempts: max, error: lastError };
}

export const SNAPSHOT_FAILED_WARNING =
	'Pengajuan tersimpan, tetapi pengecekan syarat (gate) belum berhasil disimpan. Buka detail pengajuan lalu tekan "Cek Ulang" agar approver melihat status syarat yang benar.';
