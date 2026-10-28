// src/lib/utils/offlineSopCache.ts
// R2 (roadmap AI Training & SOP): SOP bisa dibaca offline di lapangan. Cache SOP di
// IndexedDB saat online, konfirmasi baca diantre lalu dikirim saat online lagi.
// Pola sama seperti offlinePeminjamanQueue.ts (preseden L4/Bab 11).

import { openDB, type IDBPDatabase } from 'idb';
import type { SopDocument } from '$lib/services/ess/sop';

export interface QueuedSopConfirmation {
	client_txn_id: string;
	sopId: number;
	createdAt: string;
}

const DB_NAME = 'epi_sop_cache';
const SOP_STORE = 'cached_sop';
const LIST_STORE = 'cached_sop_list';
const CONFIRM_STORE = 'pending_sop_confirmations';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
	if (typeof indexedDB === 'undefined') {
		throw new Error('IndexedDB tidak tersedia di perangkat ini');
	}
	if (!dbPromise) {
		dbPromise = openDB(DB_NAME, 1, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(SOP_STORE)) db.createObjectStore(SOP_STORE, { keyPath: 'id' });
				if (!db.objectStoreNames.contains(LIST_STORE)) db.createObjectStore(LIST_STORE, { keyPath: 'key' });
				if (!db.objectStoreNames.contains(CONFIRM_STORE)) db.createObjectStore(CONFIRM_STORE, { keyPath: 'client_txn_id' });
			}
		});
	}
	return dbPromise;
}

export async function cacheSopDetail(sop: SopDocument): Promise<void> {
	try {
		const db = await getDb();
		await db.put(SOP_STORE, sop);
	} catch {
		/* non-fatal: cache adalah kenyamanan, bukan sumber kebenaran */
	}
}

export async function getCachedSopDetail(id: number): Promise<SopDocument | null> {
	try {
		const db = await getDb();
		return (await db.get(SOP_STORE, id)) || null;
	} catch {
		return null;
	}
}

export async function cacheSopList(sopList: SopDocument[]): Promise<void> {
	try {
		const db = await getDb();
		await db.put(LIST_STORE, { key: 'latest', sopList, cachedAt: new Date().toISOString() });
		await Promise.all(sopList.map((s) => db.put(SOP_STORE, s)));
	} catch {
		/* non-fatal */
	}
}

export async function getCachedSopList(): Promise<SopDocument[]> {
	try {
		const db = await getDb();
		const row = await db.get(LIST_STORE, 'latest');
		return row?.sopList || [];
	} catch {
		return [];
	}
}

export async function enqueueSopConfirmation(sopId: number): Promise<void> {
	const db = await getDb();
	await db.put(CONFIRM_STORE, { client_txn_id: crypto.randomUUID(), sopId, createdAt: new Date().toISOString() });
}

export async function getQueuedSopConfirmations(): Promise<QueuedSopConfirmation[]> {
	try {
		const db = await getDb();
		return await db.getAll(CONFIRM_STORE);
	} catch {
		return [];
	}
}

async function removeQueuedSopConfirmation(clientTxnId: string): Promise<void> {
	const db = await getDb();
	await db.delete(CONFIRM_STORE, clientTxnId);
}

/** Kirim ulang semua konfirmasi baca tertunda. Yang berhasil dihapus; yang gagal tetap tersimpan. */
export async function flushSopConfirmationQueue(sendFn: (sopId: number) => Promise<void>): Promise<{ sent: number; failed: number }> {
	const queue = await getQueuedSopConfirmations();
	let sent = 0;
	let failed = 0;
	for (const entry of queue) {
		try {
			await sendFn(entry.sopId);
			await removeQueuedSopConfirmation(entry.client_txn_id);
			sent++;
		} catch {
			failed++;
		}
	}
	return { sent, failed };
}

/** Daftarkan auto-flush saat koneksi kembali online. Panggil sekali per halaman. */
export function registerSopAutoFlush(sendFn: (sopId: number) => Promise<void>) {
	if (typeof window === 'undefined') return;
	window.addEventListener('online', () => {
		flushSopConfirmationQueue(sendFn).catch(() => {});
	});
}
