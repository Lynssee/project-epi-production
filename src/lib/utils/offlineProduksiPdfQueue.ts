// src/lib/utils/offlineProduksiPdfQueue.ts
// Export Produksi v2 — Fase 4 §6.4. Antrean permintaan PDF produksi yang dibuat
// SAAT OFFLINE: payload tabel disimpan (IndexedDB via offlineQueueFactory), lalu
// saat online kembali di-flush → render PDF di server (Gotenberg) → diserahkan ke
// user (Web Share / unduh) + notifikasi. Konsumen: ProduksiExportSheet.svelte.
//
// Idempotency: client_txn_id unik per permintaan. Retry aman (PDF read-only, tidak
// menulis apa pun ke DB).

import { createOfflineQueue } from './offlineQueueFactory';

export interface QueuedProduksiPdf {
	client_txn_id: string;
	section: string;
	judul: string;
	subjudul: string;
	landscape: boolean;
	kolom: string[];
	baris: Array<Array<string | number | null>>;
	filename: string;
	createdAt: string;
}

const queue = createOfflineQueue<QueuedProduksiPdf>({
	dbName: 'epi_produksi_pdf_queue',
	storeName: 'pending_pdf'
});

export const enqueueProduksiPdf = queue.enqueue;
export const getQueuedProduksiPdf = queue.getQueued;
export const removeQueuedProduksiPdf = queue.removeQueued;
export const flushProduksiPdfQueue = queue.flush;
export const registerProduksiPdfAutoFlush = queue.registerAutoFlush;
