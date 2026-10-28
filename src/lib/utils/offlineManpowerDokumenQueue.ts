// src/lib/utils/offlineManpowerDokumenQueue.ts
// Akuntabilitas Pembayaran Manpower v3 — F4.4: antrian offline unggah dokumen manpower dari
// lokasi (foto KTP/BPJS/SKK dari HP) — satu foto per submission, pola sama offlineGRQueue.ts
// tapi lebih sederhana (nol GPS/watermark, dokumen identitas bukan bukti serah-terima).

import { createOfflineQueue } from './offlineQueueFactory';

export interface QueuedManpowerDokumen {
	client_txn_id: string;
	manpowerId: number;
	manpowerNama: string;
	jenisDokumen: string;
	tanggalKedaluwarsa: string | null;
	photoBlob: Blob;
	photoName: string;
	createdAt: string;
}

const queue = createOfflineQueue<QueuedManpowerDokumen>({
	dbName: 'epi_manpower_dokumen_queue',
	storeName: 'pending_manpower_dokumen'
});

export const enqueueManpowerDokumen = queue.enqueue;
export const getQueuedManpowerDokumen = queue.getQueued;
export const removeQueuedManpowerDokumen = queue.removeQueued;

/** Kirim ulang semua unggahan dokumen tertunda. Yang berhasil dihapus; yang gagal tetap tersimpan. */
export const flushManpowerDokumenQueue = queue.flush;

/** Daftarkan auto-flush saat koneksi kembali online. Panggil sekali di halaman /manpower. */
export const registerManpowerDokumenAutoFlush = queue.registerAutoFlush;
