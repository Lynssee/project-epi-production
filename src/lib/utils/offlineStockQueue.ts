// src/lib/utils/offlineStockQueue.ts
// Antrian offline khusus Stock Lapangan (Fase 1 rencana Maksimalkan Modul Inventory,
// 2026-07-07). Fase 4 konsolidasi (rencana "Package & Fitur Addons" §5) — implementasi
// internal sekarang createOfflineQueue() (offlineQueueFactory.ts), export tetap sama
// persis supaya konsumen (halaman Stock Lapangan) tidak perlu diubah.
// Beda dari offlineQueue.ts (localStorage, JSON-only, dipakai driver.ts): submission
// Stock Lapangan wajib menyertakan foto (Blob) sehingga butuh IndexedDB. client_txn_id
// dibuat di sisi klien SEBELUM percobaan kirim pertama, sehingga retry tetap idempoten
// (stock_transactions.client_txn_id sudah unique di Directus).

import { createOfflineQueue } from './offlineQueueFactory';

export type StockSubmissionType = 'masuk' | 'output' | 'opname' | 'persiapan';

export interface QueuedStockSubmission {
	client_txn_id: string;
	type: StockSubmissionType;
	payload: Record<string, unknown>;
	photoBlob: Blob | null;
	photoName: string | null;
	createdAt: string;
}

const queue = createOfflineQueue<QueuedStockSubmission>({
	dbName: 'epi_stock_queue',
	storeName: 'pending_submissions'
});

export const enqueueStockSubmission = queue.enqueue;
export const getQueuedSubmissions = queue.getQueued;
export const removeQueuedSubmission = queue.removeQueued;

/**
 * Kirim ulang semua submission tertunda. sendFn bertanggung jawab menghubungi
 * stockLapangan.ts (upload foto + panggil submit* yang sesuai). Yang berhasil
 * dihapus dari antrian; yang gagal (mis. masih offline) tetap tersimpan.
 */
export const flushStockQueue = queue.flush;

/** Daftarkan auto-flush saat koneksi kembali online. Panggil sekali per halaman Stock Lapangan. */
export const registerStockAutoFlush = queue.registerAutoFlush;
