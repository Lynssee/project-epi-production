// src/lib/utils/offlineLaporanHarianQueue.ts
// Rekomendasi Tambahan Lapangan #3 (Offline Mode Enhancement, Pertajam Ciketing) —
// antrian offline untuk Kartu ① "Laporan Harian Workshop" (/workshop). Beda dengan
// draf localStorage yang sudah ada (Fase 5 §Draf otomatis, anti-hilang-input saat
// mengetik): antrian ini menyimpan SUBMISSION yang GAGAL TERKIRIM karena offline,
// lengkap dengan foto (Blob, localStorage tidak muat), untuk dikirim ulang otomatis
// begitu sinyal kembali — bukan sekadar draf yang menunggu diketik ulang.

import { createOfflineQueue } from './offlineQueueFactory';
import type { LaporanPoDetailInput, LaporanAbsensiInput, LaporanMaterialInput } from '$lib/services/workshopOpsApi';

export interface QueuedLaporanHarianSubmission {
	/** Workshop tujuan (Fase 7c). Entri lama tanpa field ini = 'ciketing'. */
	ws?: 'ciketing' | 'balaraja';
	client_txn_id: string;
	tanggal: string;
	cuaca: string;
	jumlah_tenaga: number;
	kendala: string;
	catatan: string;
	dibuat_oleh: string | null;
	po_details: LaporanPoDetailInput[];
	fotoBlobs: Blob[];
	/** WSK-13 §4a — entri lama tidak punya field di bawah ini (kompatibel mundur). */
	absensi?: LaporanAbsensiInput[];
	materials?: LaporanMaterialInput[];
	fotoAbsensiMasukBlob?: Blob | null;
	fotoAbsensiPulangBlob?: Blob | null;
	/** foto progres per PO: po_id → blob[] */
	poFotoBlobs?: Record<number, Blob[]>;
	createdAt: string;
}

const queue = createOfflineQueue<QueuedLaporanHarianSubmission>({
	dbName: 'epi_workshop_laporan_harian_queue',
	storeName: 'pending_laporan_harian'
});

export const enqueueLaporanHarianSubmission = queue.enqueue;
export const getQueuedLaporanHarianSubmissions = queue.getQueued;
export const removeQueuedLaporanHarianSubmission = queue.removeQueued;

/** Kirim ulang semua laporan harian tertunda. Yang berhasil dihapus; yang gagal (masih offline) tetap tersimpan. */
export const flushLaporanHarianQueue = queue.flush;

/** Daftarkan auto-flush saat koneksi kembali online. Panggil sekali di halaman /workshop. */
export const registerLaporanHarianAutoFlush = queue.registerAutoFlush;
