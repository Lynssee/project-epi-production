// src/lib/utils/offlineComplaintQueue.ts
// Antrian offline untuk Lapor Komplain Customer (Fase 7, Pertajam KPI Marketing &
// Manufaktur v2). Fase 4 konsolidasi (rencana "Package & Fitur Addons" §5) —
// implementasi internal sekarang createOfflineQueue() (offlineQueueFactory.ts), export
// tetap sama persis supaya konsumen (komplain-customer) tidak perlu diubah.

import { createOfflineQueue } from './offlineQueueFactory';

export interface QueuedComplaint {
	client_txn_id: string;
	customer_id: number | null;
	kategori: string;
	deskripsi: string;
	site: string;
	pic: string | null;
	batch_number?: string | null;
	prioritas?: string | null;
	kontak_pelapor?: string | null;
	photoBlob: Blob | null;
	photoName: string | null;
	createdAt: string;
}

const queue = createOfflineQueue<QueuedComplaint>({
	dbName: 'epi_complaint_queue',
	storeName: 'pending_complaints'
});

export const enqueueComplaint = queue.enqueue;
export const getQueuedComplaints = queue.getQueued;
export const removeQueuedComplaint = queue.removeQueued;
export const flushComplaintQueue = queue.flush;
export const registerComplaintAutoFlush = queue.registerAutoFlush;
