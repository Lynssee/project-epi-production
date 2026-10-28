// src/lib/utils/offlineGRQueue.ts
// Antrian offline khusus konfirmasi Goods Received (Fase 5, Rencana GR Proyek v2.0).
// Fase 4 konsolidasi (rencana "Package & Fitur Addons" §5) — implementasi internal
// sekarang createOfflineQueue() (offlineQueueFactory.ts), export tetap sama persis
// supaya konsumen (halaman GR) tidak perlu diubah.
// Beda dari offlineStockQueue.ts (satu foto per submission): GR bisa punya beberapa
// bukti biner sekaligus (foto serah-terima, scan SJ, TTD penerima, TTD driver, multi-foto
// tambahan) — disimpan sebagai map blob terpisah (`blobs`), bukan satu photoBlob tunggal.
// Faktornya generik atas tipe T sehingga bentuk `blobs` di bawah tidak perlu perlakuan
// khusus di factory — hanya bagian dari payload domain ini.

import { createOfflineQueue } from './offlineQueueFactory';
import type { GRCondition } from '$lib/constants/grCondition';

export interface QueuedGRItem {
	project_expense_id: number;
	qty_received: number;
	condition?: GRCondition;
	identitas_barang_id: number | null; // untuk replay efek stok fisik lapangan saat flush
	material_name: string;
}

export interface QueuedGRSubmission {
	client_txn_id: string;
	suratJalanId: number;
	nomorSJ: string;
	items: QueuedGRItem[];
	gps: { lat: number; lng: number; accuracy: number } | null;
	blobs: {
		fotoTerima: Blob; // wajib — sama seperti alur online
		scanSj?: Blob;
		ttdPenerima?: Blob;
		ttdDriver?: Blob;
		extraPhotos?: Blob[];
	};
	createdAt: string;
}

const queue = createOfflineQueue<QueuedGRSubmission>({
	dbName: 'epi_gr_queue',
	storeName: 'pending_gr_submissions'
});

export const enqueueGRSubmission = queue.enqueue;
export const getQueuedGRSubmissions = queue.getQueued;
export const removeQueuedGRSubmission = queue.removeQueued;

/** Kirim ulang semua konfirmasi GR tertunda. Yang berhasil dihapus; yang gagal (masih offline) tetap tersimpan. */
export const flushGRQueue = queue.flush;

/** Daftarkan auto-flush saat koneksi kembali online. Panggil sekali per halaman GR. */
export const registerGRAutoFlush = queue.registerAutoFlush;
