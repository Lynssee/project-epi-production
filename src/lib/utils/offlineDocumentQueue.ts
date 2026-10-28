// src/lib/utils/offlineDocumentQueue.ts
// Pertajam Modul Dokumen Proyek, Fase 3 (lanjutan) — antrian offline upload dokumen
// proyek dari lokasi (sinyal lemah di lapangan). Pola sama offlineManpowerDokumenQueue.ts,
// bedanya dokumen bisa file apa saja (bukan cuma foto identitas) dan tertaut ke project_documents.

import { createOfflineQueue } from './offlineQueueFactory';

export interface QueuedDocumentUpload {
	client_txn_id: string;
	projectId: number;
	fileBlob: Blob;
	fileName: string;
	namaDokumen: string;
	documentTypeId: number | null;
	documentPhase: string | null;
	isSensitive: boolean;
	uploadedByName: string | null;
	createdAt: string;
}

const queue = createOfflineQueue<QueuedDocumentUpload>({
	dbName: 'epi_project_document_queue',
	storeName: 'pending_project_documents'
});

export const enqueueDocumentUpload = queue.enqueue;
export const getQueuedDocumentUploads = queue.getQueued;
export const removeQueuedDocumentUpload = queue.removeQueued;

/** Kirim ulang semua upload dokumen tertunda. Yang berhasil dihapus; yang gagal tetap tersimpan. */
export const flushDocumentQueue = queue.flush;

/** Daftarkan auto-flush saat koneksi kembali online. Panggil sekali per halaman proyek. */
export const registerDocumentQueueAutoFlush = queue.registerAutoFlush;
