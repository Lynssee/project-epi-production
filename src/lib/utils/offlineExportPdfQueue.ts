// src/lib/utils/offlineExportPdfQueue.ts
// Fase "Export Universal — Dashboard Lapangan" (§5.5 rencana).
//
// PDF lapangan HANYA bisa dibuat server (Gotenberg) → butuh koneksi. Saat offline,
// permintaan PDF tidak digagalkan (Aturan #6) — dimasukkan antrian IndexedDB dan
// dikirim otomatis begitu online, lalu file langsung terunduh + notifikasi.
//
// Pakai ulang createOfflineQueue() (offlineQueueFactory.ts) — pola identik dengan
// 20+ antrian offline lain di repo ini.

import { createOfflineQueue } from './offlineQueueFactory';

export interface QueuedPdfExport {
	client_txn_id: string;
	projectId: number;
	section: string;
	title: string;
	columns: Array<{ header: string; key: string }>;
	rows: Array<Record<string, unknown>>;
	requestedAt: string;
}

const queue = createOfflineQueue<QueuedPdfExport>({
	dbName: 'epi_export_pdf_queue',
	storeName: 'pending_pdf_exports'
});

export const enqueuePdfExport = queue.enqueue;
export const getQueuedPdfExports = queue.getQueued;
export const removeQueuedPdfExport = queue.removeQueued;
export const flushPdfExportQueue = queue.flush;
export const registerPdfExportAutoFlush = queue.registerAutoFlush;
