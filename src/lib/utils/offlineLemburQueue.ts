// src/lib/utils/offlineLemburQueue.ts
// FITUR-6 (PWA Absensi Offline): antrian offline untuk pengajuan lembur. Fase 4
// konsolidasi (rencana "Package & Fitur Addons" §5) — implementasi internal sekarang
// createOfflineQueue() (offlineQueueFactory.ts), export tetap sama persis supaya
// konsumen (ess/lembur/baru) tidak perlu diubah. Beda dari absensi: ess_lembur TIDAK
// upsert per hari (bisa lebih dari satu pengajuan), jadi tidak ada isu idempotency 409
// seperti clock-in/out — retry aman diulang.

import { createOfflineQueue } from './offlineQueueFactory';

export interface QueuedLemburSubmission {
	client_txn_id: string;
	tanggal: string;
	jam_mulai: string;
	jam_selesai: string;
	alasan: string;
	buktiBlob: Blob | null;
	buktiName: string | null;
	latitude: number | null;
	longitude: number | null;
	proyek_id: string | null;
	createdAt: string;
}

const queue = createOfflineQueue<QueuedLemburSubmission>({
	dbName: 'epi_lembur_queue',
	storeName: 'pending_lembur'
});

export const enqueueLemburSubmission = queue.enqueue;
export const getQueuedLemburSubmissions = queue.getQueued;
export const removeQueuedLemburSubmission = queue.removeQueued;

/** Kirim ulang semua pengajuan lembur tertunda. Yang berhasil dihapus; yang gagal tetap tersimpan. */
export const flushLemburQueue = queue.flush;

/** Daftarkan auto-flush saat koneksi kembali online. Panggil sekali di halaman ess/lembur/baru. */
export const registerLemburAutoFlush = queue.registerAutoFlush;
