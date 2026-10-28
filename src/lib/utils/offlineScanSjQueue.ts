// src/lib/utils/offlineScanSjQueue.ts
// Penajaman Gate SJ — Offline Proof Buffer. Foto SJ fisik bertanda tangan (scan_sj_file) yang diambil di lokasi
// tanpa sinyal disimpan di IndexedDB HP lalu dikirim otomatis begitu online (pola sama offlineComplaintQueue).
// Kunci idempotensi = client_txn_id; unggah ulang SJ yang sama hanya menimpa scan_sj_file dengan foto terbaru.

import { createOfflineQueue } from './offlineQueueFactory';
import { isRetryableError } from './networkError';

export interface QueuedScanSj {
	client_txn_id: string;
	sjId: number | string;
	nomorSj?: string | null;
	photoBlob: Blob;
	createdAt: string;
}

const queue = createOfflineQueue<QueuedScanSj>({
	dbName: 'epi_scan_sj_queue',
	storeName: 'pending_scan_sj',
	ordered: true,
	// Hanya gangguan jaringan/server sementara yang diulang; penolakan tegas (403/409/413...) -> 'failed'.
	isRetryable: isRetryableError
});

export const enqueueScanSj = queue.enqueue;
export const getQueuedScanSj = queue.getQueued;
export const removeQueuedScanSj = queue.removeQueued;
export const flushScanSjQueue = queue.flush;
export const registerScanSjAutoFlush = queue.registerAutoFlush;
export const getFailedScanSj = queue.getFailed;
export const retryFailedScanSj = queue.retryFailed;
