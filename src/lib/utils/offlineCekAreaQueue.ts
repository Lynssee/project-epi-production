// src/lib/utils/offlineCekAreaQueue.ts
// Antrian offline untuk hasil Cek Area/Genba (Fase 3, Rencana Sistem Penempatan Area
// Inventory & Verifikasi Barcode v2, 20 Agu 2026). Dibangun lewat createOfflineQueue()
// (offlineQueueFactory.ts) -- satu pemanggilan, bukan queue tulis-tangan.

import { createOfflineQueue } from './offlineQueueFactory';
import type { CekAreaSubmitPayload } from '$lib/services/cekAreaApi';

export interface QueuedCekArea extends CekAreaSubmitPayload {
	client_txn_id: string;
}

const queue = createOfflineQueue<QueuedCekArea>({
	dbName: 'epi_cek_area_queue',
	storeName: 'pending_cek_area'
});

export const enqueueCekArea = queue.enqueue;
export const getQueuedCekArea = queue.getQueued;
export const removeQueuedCekArea = queue.removeQueued;
export const flushCekAreaQueue = queue.flush;
export const registerCekAreaAutoFlush = queue.registerAutoFlush;
