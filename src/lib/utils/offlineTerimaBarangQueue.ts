// src/lib/utils/offlineTerimaBarangQueue.ts
// Rekomendasi Tambahan Lapangan #3 (Offline Mode Enhancement, Pertajam Ciketing) —
// antrian offline untuk Kartu ② "Terima Barang Customer" (/workshop). Pola sama
// persis dengan offlineGRQueue.ts (createOfflineQueue) — 2 foto (SJ wajib, barang
// wajib bila kondisi bukan "utuh") disimpan sebagai Blob, dikirim ulang otomatis
// saat koneksi kembali (registerAutoFlush) tanpa mandor harus mengetik ulang.

import { createOfflineQueue } from './offlineQueueFactory';
import type { KondisiBarang } from '$lib/services/workshopOpsApi';

export interface QueuedTerimaBarangSubmission {
	/** Workshop tujuan (Fase 7c). Entri lama tanpa field ini = 'ciketing'. */
	ws?: 'ciketing' | 'balaraja';
	client_txn_id: string;
	projectId: number;
	no_sj: string;
	tanggal: string;
	nama_barang: string;
	qty: number;
	satuan: string;
	luasan_m2: number;
	kondisi_barang: KondisiBarang;
	pic: string | null;
	blobs: {
		fotoSj: Blob;
		fotoBarang?: Blob;
	};
	createdAt: string;
}

const queue = createOfflineQueue<QueuedTerimaBarangSubmission>({
	dbName: 'epi_workshop_terima_barang_queue',
	storeName: 'pending_terima_barang'
});

export const enqueueTerimaBarangSubmission = queue.enqueue;
export const getQueuedTerimaBarangSubmissions = queue.getQueued;
export const removeQueuedTerimaBarangSubmission = queue.removeQueued;

/** Kirim ulang semua SJ Masuk tertunda. Yang berhasil dihapus; yang gagal (masih offline) tetap tersimpan. */
export const flushTerimaBarangQueue = queue.flush;

/** Daftarkan auto-flush saat koneksi kembali online. Panggil sekali di halaman /workshop. */
export const registerTerimaBarangAutoFlush = queue.registerAutoFlush;
