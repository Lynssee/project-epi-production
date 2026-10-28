// src/lib/utils/offlineDocumentCache.ts
// Pertajam Modul Dokumen Proyek, Fase 3 (lanjutan) — Download for Offline: simpan blob
// dokumen penting (Method Statement, Drawing, dst) di IndexedDB perangkat supaya bisa
// dibuka lagi tanpa sinyal. BEDA dari offlineDocumentQueue.ts (itu untuk upload yang
// gagal terkirim, ini untuk file yang SUDAH ada di server tapi mau disimpan untuk dibaca
// offline nanti) -- jangan disatukan, arah datanya berlawanan.

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'epi_document_file_cache';
const STORE_NAME = 'cached_files';

export interface CachedDocumentFile {
	fileId: string;
	blob: Blob;
	mimeType: string;
	fileName: string;
	cachedAt: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
	if (typeof indexedDB === 'undefined') {
		throw new Error('IndexedDB tidak tersedia di perangkat ini');
	}
	if (!dbPromise) {
		dbPromise = openDB(DB_NAME, 1, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: 'fileId' });
				}
			}
		});
	}
	return dbPromise;
}

export async function cacheDocumentFile(fileId: string, blob: Blob, fileName: string): Promise<void> {
	const db = await getDb();
	await db.put(STORE_NAME, { fileId, blob, mimeType: blob.type, fileName, cachedAt: new Date().toISOString() } satisfies CachedDocumentFile);
}

export async function getCachedDocumentFile(fileId: string): Promise<CachedDocumentFile | null> {
	try {
		const db = await getDb();
		return (await db.get(STORE_NAME, fileId)) || null;
	} catch {
		return null;
	}
}

export async function removeCachedDocumentFile(fileId: string): Promise<void> {
	try {
		const db = await getDb();
		await db.delete(STORE_NAME, fileId);
	} catch {
		/* non-fatal */
	}
}

/** Daftar fileId yang sudah tersimpan offline — dipakai untuk render badge "Tersimpan Offline" tanpa cek satu-satu. */
export async function getAllCachedFileIds(): Promise<string[]> {
	try {
		const db = await getDb();
		const keys = await db.getAllKeys(STORE_NAME);
		return keys as string[];
	} catch {
		return [];
	}
}
