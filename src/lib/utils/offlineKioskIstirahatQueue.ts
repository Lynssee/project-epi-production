// src/lib/utils/offlineKioskIstirahatQueue.ts
// Rencana Absensi Istirahat v2, Fase 1 "mode luring" — antrian offline utk tap badge kiosk
// (WiFi lantai produksi biasanya paling tidak stabil, rencana v2 §9.8). Pola sama persis
// dengan antrian offline lain (createOfflineQueue, offlineQueueFactory.ts) — konsisten
// dengan offlineAttendanceQueue.ts, hanya bentuk payload beda (badge, bukan GPS karyawan).
//
// Idempotency: endpoint /api/kiosk/absen-istirahat menutup jeda TERBUKA milik karyawan.
// Bila entry ini sudah berhasil diproses sebelumnya (mis. respons hilang karena jaringan
// putus tepat setelah sukses), retry akan gagal dengan pesan "belum absen keluar istirahat"
// (jeda sudah tertutup) atau "baru saja tap" (rate-limit) — sendFn pemanggil WAJIB
// menganggap keduanya sebagai sukses, BUKAN kegagalan yang perlu diulang (lihat sendQueuedTap
// di kiosk/absen-istirahat/+page.svelte).

import { createOfflineQueue } from './offlineQueueFactory';

export interface QueuedKioskIstirahatSubmission {
	client_txn_id: string;
	noBadge: string;
	badgeToken: string;
	workstationId: string | null;
	photoBlob: Blob;
	photoName: string;
	createdAt: string;
}

const queue = createOfflineQueue<QueuedKioskIstirahatSubmission>({
	dbName: 'epi_kiosk_istirahat_queue',
	storeName: 'pending_taps'
});

export const enqueueKioskIstirahatSubmission = queue.enqueue;
export const getQueuedKioskIstirahatSubmissions = queue.getQueued;
export const removeQueuedKioskIstirahatSubmission = queue.removeQueued;
export const flushKioskIstirahatQueue = queue.flush;
export const registerKioskIstirahatAutoFlush = queue.registerAutoFlush;
