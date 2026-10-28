// src/lib/utils/offlineBiayaLapanganQueue.ts
// Antrian offline untuk pengajuan Biaya Lapangan (BBM/Tol/Parkir/Lain-lain, reimburse
// & realisasi proyek). Rekomendasi "Offline-First Receipt Capture" dari rekonsiliasi
// rekening koran Jan-Agu 2026 (§5 dashboard lapangan) — leader di lokasi tanpa sinyal
// (mis. site Sorong/tambang) bisa tetap memotret & mencatat struk, terkirim otomatis
// begitu sinyal kembali.
//
// Sama seperti offlineGRQueue.ts: form ini bisa punya 2 foto sekaligus (struk + odometer),
// disimpan sebagai map blob terpisah, bukan satu photoBlob tunggal. Beda dari GR: endpoint
// /api/biaya-lapangan menerima SEMUA field (termasuk foto) dalam satu multipart FormData —
// jadi flush di sini merekonstruksi FormData yang sama persis, bukan upload-lalu-JSON.

import { createOfflineQueue } from './offlineQueueFactory';

export interface QueuedBiayaLapanganFields {
	jenis: string;
	nominal: string;
	mode: string;
	project_id?: string;
	for_karyawan_id?: string;
	trip_id?: string;
	site_checkin_id?: string;
	catatan?: string;
	vehicle_id?: string;
	odometer?: string;
}

export interface QueuedBiayaLapangan {
	client_txn_id: string;
	fields: QueuedBiayaLapanganFields;
	blobs: {
		fotoStruk?: Blob;
		fotoOdometer?: Blob;
	};
	createdAt: string;
}

const queue = createOfflineQueue<QueuedBiayaLapangan>({
	dbName: 'epi_biaya_lapangan_queue',
	storeName: 'pending_biaya_lapangan'
});

export const enqueueBiayaLapangan = queue.enqueue;
export const getQueuedBiayaLapangan = queue.getQueued;
export const removeQueuedBiayaLapangan = queue.removeQueued;

/** Kirim ulang semua pengajuan biaya lapangan tertunda. Gagal (masih offline) tetap tersimpan. */
export const flushBiayaLapanganQueue = queue.flush;

/** Daftarkan auto-flush saat koneksi kembali online. Panggil sekali di halaman biaya-lapangan. */
export const registerBiayaLapanganAutoFlush = queue.registerAutoFlush;
