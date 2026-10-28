// src/lib/utils/offlinePunchQueue.ts
// Antrian offline untuk Punch List Quality Management v2, Fase 2 (R5: "Sinyal site jelek;
// input inspeksi sering gagal kirim"). Fase 4 konsolidasi (rencana "Package & Fitur
// Addons" §5) — implementasi internal sekarang createOfflineQueue()
// (offlineQueueFactory.ts), export tetap sama persis supaya konsumen (halaman punch-list)
// tidak perlu diubah.
//
// Idempotency: project_punch_list.client_txn_id adalah kolom unique (beda dari absensi
// yang tak punya kolom ini) — retry aman by construction, tidak perlu penanganan 409 khusus.

import { createOfflineQueue } from './offlineQueueFactory';

export interface QueuedPunchSubmission {
	client_txn_id: string;
	project_id: number;
	area_zone: string | null;
	severity: string;
	deskripsi: string;
	lat: number | null;
	lng: number | null;
	photoBlob: Blob | null;
	photoName: string | null;
	created_by_name: string | null;
	createdAt: string;
}

const queue = createOfflineQueue<QueuedPunchSubmission>({
	dbName: 'epi_punch_queue',
	storeName: 'pending_punches'
});

export const enqueuePunchSubmission = queue.enqueue;
export const getQueuedPunchSubmissions = queue.getQueued;
export const removeQueuedPunchSubmission = queue.removeQueued;

/** Kirim ulang semua punch tertunda. Yang berhasil dihapus dari antrian; yang gagal tetap tersimpan. */
export const flushPunchQueue = queue.flush;

/** Daftarkan auto-flush saat koneksi kembali online. Panggil sekali di halaman punch-list. */
export const registerPunchAutoFlush = queue.registerAutoFlush;
