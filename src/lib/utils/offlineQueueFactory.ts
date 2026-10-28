// src/lib/utils/offlineQueueFactory.ts
// Factory serbaguna untuk antrean IndexedDB offline.
//
// Evolusi (Site Visit Release Paket 02):
//   1. `ordered: true` — entri diproses FIFO berdasar createdAt, dan jika satu entri gagal
//      karena error sementara (jaringan), flush berhenti seketika supaya operasi berikutnya
//      (mis. checkout setelah checkin) tidak mendahului yang belum berhasil di server.
//   2. `isRetryable` — pembeda error jaringan/server sementara (tetap di antrean, diulang)
//      vs error permanen (ditandai 'failed', tidak diulang otomatis, tampil di UI untuk
//      "Coba lagi"/"Hapus" manual). Default `() => true` = perilaku lama (semua diulang
//      selamanya, sama seperti sebelum paket ini ada).
//   3. Kunci in-memory pada `flush()` — panggilan paralel (mount + event online + interval
//      terjadwal bersamaan) menunggu proses yang sedang berjalan, bukan menjalankan dua kali.

import { openDB, type IDBPDatabase } from 'idb';

/** File 03 §3.7 — kegagalan PERMANEN (server menolak dengan tegas, mis. 400/409 karena SPK
 *  sudah ditutup), berbeda dari kegagalan sementara (jaringan/5xx) yang memang harus diulang
 *  selamanya sampai berhasil. `sendFn` melempar ini untuk keluar dari antrean aktif tanpa
 *  dihitung sebagai "akan dicoba lagi". */
export class PermanentQueueError extends Error {}

export interface OfflineQueueEntryBase {
	client_txn_id: string;
	/** Opt-in (§3.3). Entri lama tanpa field ini diperlakukan 'pending' — kompatibel mundur. */
	status?: 'pending' | 'failed';
	last_error?: string | null;
	attempts?: number;
	/** Dipakai untuk pengurutan bila opts.ordered=true. Opsional supaya antrean yang tidak
	 *  punya field ini (mis. beberapa antrean lama) tetap valid — akan diurut sebagai string kosong. */
	createdAt?: string;
}

export interface OfflineQueueHandle<T extends OfflineQueueEntryBase> {
	enqueue(entry: T): Promise<void>;
	/** Entri berstatus 'pending' (atau tanpa status — entri lama) saja; 'failed' TIDAK ikut,
	 *  lihat getFailed(). Diurut createdAt bila opts.ordered=true, selain itu urutan penyimpanan. */
	getQueued(): Promise<T[]>;
	removeQueued(clientTxnId: string): Promise<void>;
	flush(sendFn: (entry: T) => Promise<void>): Promise<{ sent: number; failed: number; permanentlyFailed: T[] }>;
	/** Mengembalikan fungsi untuk melepas listener 'online' — panggil di onDestroy */
	registerAutoFlush(sendFn: (entry: T) => Promise<void>): () => void;
	/** Tandai entri sebagai gagal permanen (dipanggil factory sendiri saat isRetryable === false;
	 *  diekspor juga untuk kasus pemanggil ingin menandai manual). */
	markFailed(clientTxnId: string, error: string): Promise<void>;
	/** Kembalikan entri 'failed' ke 'pending' supaya dicoba lagi saat flush berikutnya. */
	retryFailed(clientTxnId: string): Promise<void>;
	/** Entri berstatus 'failed' — untuk ditampilkan di UI ("Coba lagi" / "Hapus"). */
	getFailed(): Promise<T[]>;
}

export interface CreateOfflineQueueOptions {
	dbName: string;
	storeName: string;
	/** Default false (perilaku lama — urutan penyimpanan, tidak berhenti di kegagalan). */
	ordered?: boolean;
	/** Default `() => true` (perilaku lama — semua error dianggap layak diulang selamanya,
	 *  entri tidak pernah ditandai 'failed' otomatis). */
	isRetryable?: (err: unknown) => boolean;
}

export function createOfflineQueue<T extends OfflineQueueEntryBase>(
	opts: CreateOfflineQueueOptions
): OfflineQueueHandle<T> {
	const { dbName, storeName, ordered = false, isRetryable = () => true } = opts;
	let dbPromise: Promise<IDBPDatabase> | null = null;
	// Kunci in-memory per instance factory (per antrean) — bukan global, supaya antrean site
	// check-in dan antrean stock (mis.) tidak saling menunggu satu sama lain.
	let flushing: Promise<{ sent: number; failed: number; permanentlyFailed: T[] }> | null = null;

	function getDb(): Promise<IDBPDatabase> {
		if (typeof indexedDB === 'undefined') {
			throw new Error('IndexedDB tidak tersedia di perangkat ini');
		}
		if (!dbPromise) {
			dbPromise = openDB(dbName, 1, {
				upgrade(db) {
					if (!db.objectStoreNames.contains(storeName)) {
						db.createObjectStore(storeName, { keyPath: 'client_txn_id' });
					}
				}
			});
		}
		return dbPromise;
	}

	async function enqueue(entry: T): Promise<void> {
		const db = await getDb();
		await db.put(storeName, entry);
	}

	async function getAllRaw(): Promise<T[]> {
		try {
			const db = await getDb();
			return await db.getAll(storeName);
		} catch {
			return [];
		}
	}

	async function getQueued(): Promise<T[]> {
		const all = await getAllRaw();
		const pending = all.filter((e) => (e.status ?? 'pending') === 'pending');
		if (!ordered) return pending;
		return [...pending].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
	}

	async function getFailed(): Promise<T[]> {
		const all = await getAllRaw();
		return all.filter((e) => e.status === 'failed');
	}

	async function removeQueued(clientTxnId: string): Promise<void> {
		const db = await getDb();
		await db.delete(storeName, clientTxnId);
	}

	async function markFailed(clientTxnId: string, error: string): Promise<void> {
		const db = await getDb();
		const existing = await db.get(storeName, clientTxnId);
		if (!existing) return;
		await db.put(storeName, {
			...existing,
			status: 'failed',
			last_error: error,
			attempts: (existing.attempts ?? 0) + 1
		});
	}

	async function retryFailed(clientTxnId: string): Promise<void> {
		const db = await getDb();
		const existing = await db.get(storeName, clientTxnId);
		if (!existing) return;
		await db.put(storeName, { ...existing, status: 'pending', last_error: null });
	}

	async function runFlush(sendFn: (entry: T) => Promise<void>): Promise<{ sent: number; failed: number; permanentlyFailed: T[] }> {
		const queue = await getQueued();
		let sent = 0;
		let failed = 0;
		const permanentlyFailed: T[] = [];
		for (const entry of queue) {
			try {
				await sendFn(entry);
				await removeQueued(entry.client_txn_id);
				sent++;
			} catch (err) {
				failed++;
				if (err instanceof PermanentQueueError) {
					// Server sudah menolak tegas (bukan gangguan jaringan) — keluarkan dari antrean
					// aktif supaya tidak diulang selamanya, tapi tetap dilaporkan ke pemanggil.
					await removeQueued(entry.client_txn_id).catch(() => {});
					permanentlyFailed.push(entry);
				} else if (isRetryable(err)) {
					// Sementara/jaringan — tetap di antrean, dicoba lagi flush berikutnya.
					if (ordered) break; // jangan lompati urutan demi entri setelahnya
					// unordered (perilaku lama): lanjut ke entri berikutnya
				} else {
					// Permanen — tandai 'failed' supaya tidak diulang otomatis selamanya;
					// tetap lanjut ke entri lain (independen, tidak terkait kegagalan ini).
					const msg = err instanceof Error ? err.message : String(err);
					await markFailed(entry.client_txn_id, msg);
				}
			}
		}
		return { sent, failed, permanentlyFailed };
	}

	async function flush(sendFn: (entry: T) => Promise<void>): Promise<{ sent: number; failed: number; permanentlyFailed: T[] }> {
		if (flushing) return flushing;
		const run = runFlush(sendFn).finally(() => {
			if (flushing === run) flushing = null;
		});
		flushing = run;
		return run;
	}

	function registerAutoFlush(sendFn: (entry: T) => Promise<void>): () => void {
		if (typeof window === 'undefined') return () => {};
		const onOnline = () => {
			flush(sendFn).catch(() => {});
		};
		window.addEventListener('online', onOnline);
		return () => window.removeEventListener('online', onOnline);
	}

	return { enqueue, getQueued, removeQueued, flush, registerAutoFlush, markFailed, retryFailed, getFailed };
}
