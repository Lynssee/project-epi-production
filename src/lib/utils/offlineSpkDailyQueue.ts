// src/lib/utils/offlineSpkDailyQueue.ts
// Antrian offline untuk Input Produksi Harian (Fase 7, Pertajam KPI Marketing &
// Manufaktur v2). Fase 4 konsolidasi (rencana "Package & Fitur Addons" §5) —
// implementasi internal sekarang createOfflineQueue() (offlineQueueFactory.ts), export
// tetap sama persis supaya konsumen (produksi/input-harian) tidak perlu diubah.
// spk_daily_log.client_txn_id unique — retry aman by construction.

import { createOfflineQueue } from './offlineQueueFactory';

export interface QueuedSpkDailyLog {
	client_txn_id: string;
	spk_id: number;
	tanggal: string;
	output_kg: number | null;
	reject_kg: number | null;
	waste_kg: number | null;
	catatan: string | null;
	input_by: string | null;
	createdAt: string;
}

const queue = createOfflineQueue<QueuedSpkDailyLog>({
	dbName: 'epi_spk_daily_queue',
	storeName: 'pending_logs'
});

export const enqueueSpkDailyLog = queue.enqueue;
export const getQueuedSpkDailyLogs = queue.getQueued;
export const removeQueuedSpkDailyLog = queue.removeQueued;
export const flushSpkDailyQueue = queue.flush;
export const registerSpkDailyAutoFlush = queue.registerAutoFlush;
