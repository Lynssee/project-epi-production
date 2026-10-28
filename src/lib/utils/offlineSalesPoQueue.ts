// src/lib/utils/offlineSalesPoQueue.ts
// Antrian offline untuk unggah dokumen PO Customer dari lapangan (Fase 2, Sales
// B2B PO/RAP v2). Sama seperti offlineComplaintQueue.ts — implementasi via
// createOfflineQueue() (offlineQueueFactory.ts).

import { createOfflineQueue } from './offlineQueueFactory';

export interface QueuedPoUpload {
	client_txn_id: string;
	soId: number;
	photoBlob: Blob;
	photoName: string;
	uploadedBy: string;
	createdAt: string;
}

const queue = createOfflineQueue<QueuedPoUpload>({
	dbName: 'epi_sales_po_queue',
	storeName: 'pending_po_uploads'
});

export const enqueuePoUpload = queue.enqueue;
export const getQueuedPoUploads = queue.getQueued;
export const removeQueuedPoUpload = queue.removeQueued;
export const flushPoUploadQueue = queue.flush;
export const registerPoUploadAutoFlush = queue.registerAutoFlush;
