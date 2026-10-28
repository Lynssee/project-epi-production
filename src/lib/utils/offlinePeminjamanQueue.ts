// src/lib/utils/offlinePeminjamanQueue.ts
// L4 (Bab 11, rencana v2.0): antrean offline untuk scan Peminjaman External — Proof of
// Delivery driver & konfirmasi retur/kedatangan satpam. Fase 4 konsolidasi (rencana
// "Package & Fitur Addons" §5) — implementasi internal sekarang createOfflineQueue()
// (offlineQueueFactory.ts), export tetap sama persis supaya konsumen (scan/[code],
// satpam/gate) tidak perlu diubah.
// Payload disimpan sebagai discriminated union (`kind: 'pod' | 'gate'`) dalam satu
// store — factory generik atas tipe T sehingga ini tidak perlu perlakuan khusus.

import { createOfflineQueue } from './offlineQueueFactory';

export interface QueuedPodSubmission {
	kind: 'pod';
	client_txn_id: string;
	suratJalanId: number;
	gps: { lat: number; lng: number; accuracy: number } | null;
	signatureBlob?: Blob;
	photoBlob?: Blob;
	createdAt: string;
}

export interface QueuedGateScan {
	kind: 'gate';
	client_txn_id: string;
	code: string;
	items: Array<{ id: number; kondisiKembali: string }>;
	createdAt: string;
}

export type QueuedPeminjamanEntry = QueuedPodSubmission | QueuedGateScan;

const queue = createOfflineQueue<QueuedPeminjamanEntry>({
	dbName: 'epi_peminjaman_queue',
	storeName: 'pending_peminjaman_scans'
});

export const enqueuePeminjamanScan = queue.enqueue;
export const getQueuedPeminjamanScans = queue.getQueued;
export const removeQueuedPeminjamanScan = queue.removeQueued;

/** Kirim ulang semua scan tertunda. Yang berhasil dihapus; yang gagal (masih offline) tetap tersimpan. */
export const flushPeminjamanQueue = queue.flush;

/** Daftarkan auto-flush saat koneksi kembali online. Panggil sekali per halaman. */
export const registerPeminjamanAutoFlush = queue.registerAutoFlush;
