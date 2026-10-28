// src/lib/utils/offlineSiteCheckinQueue.ts
// Fase 3 (L4, wajib sejak Fase 3): antrean offline untuk check-in/out Site Check-in di
// lokasi bersinyal buruk. Reuse createOfflineQueue() (offlineQueueFactory.ts) — pola sama
// persis dengan offlineAttendanceQueue.ts, jangan tulis ulang.
//
// Paket 02 Site Visit Release (docs/(analyst) site visit/02_offline-idempotensi.md §3.4) — v2:
//   - ordered:true + isRetryable:isRetryableError — flush BENAR-BENAR berurutan createdAt
//     (sebelumnya urutan IndexedDB/UUID acak walau komentar lama mengklaim createdAt) dan
//     berhenti di kegagalan jaringan pertama, supaya checkout TIDAK PERNAH terkirim
//     mendahului check-in pasangannya yang masih di antrean.
//   - status/last_error/attempts (dari factory) — entri gagal PERMANEN (referensi tidak
//     valid, dll) ditandai 'failed', tidak diulang otomatis selamanya; tampil di UI untuk
//     "Coba lagi"/"Hapus" (markFailed/retryFailed/getFailed diekspor di bawah).
//   - tipeKeperluan/bookingId/namaLokasi/checkinClientTxnId/extra: field baru, SEMUA opsional
//     supaya entri v1 (tersimpan di HP sebelum update ini) tetap valid tanpa migrasi data.
//
// Paket 08c Site Visit Release §5.3 — jalur sales (/sales/baru) kini juga memakai antrean ini:
// tipeKeperluan:'marketing', extra.jalur='sales', extra.target_type ('customer'|'prospect'),
// extra.target_id, extra.tujuan. referensiId SENGAJA null untuk entri jalur sales (target ada
// di extra, bukan referensiId — field itu dipakai tipe proyek/maintenance). Lihat
// siteCheckinSync.ts untuk pengiriman ulangnya (checkInVisit dari services/sales.ts, bukan
// submitCheckin). Checkout/submit-hasil OFFLINE untuk jalur sales BELUM didukung (butuh cache
// data kunjungan + halaman resume terpisah) — hanya check-in yang write-ahead di sini.

import { createOfflineQueue } from './offlineQueueFactory';
import { isRetryableError } from './networkError';

export type SiteCheckinActionType = 'checkin' | 'checkout';

export interface QueuedSiteCheckinSubmission {
	v?: 2;
	client_txn_id: string;
	type: SiteCheckinActionType;
	status?: 'pending' | 'failed';
	last_error?: string | null;
	attempts?: number;
	referensiId: number | string | null; // wajib untuk 'checkin', null untuk 'checkout'. string = UUID WO (maintenance, belum aktif paket ini).
	namaLokasi?: string | null; // untuk tampilan lokal "aktif di …" sebelum tersinkron ke server
	checkinId: string | null; // wajib untuk 'checkout' bila check-in pasangannya SUDAH tersinkron
	// Bila checkinId masih null saat checkout diantrekan (check-in pasangannya SENDIRI masih
	// menunggu di antrean) — server me-resolve checkin_id dari checkin_client_txn_id ini
	// setelah check-in pasangannya sukses (lihat siteCheckinSync.ts, dikerjakan berurutan).
	checkinClientTxnId?: string | null;
	// Field checkout per tipe non-proyek (marketing/maintenance) — disiapkan, belum dipakai.
	extra?: Record<string, string>;
	// SV-12: null (bukan 0,0 — koordinat nyata di Teluk Guinea) bila GPS gagal didapat saat
	// checkout offline. 0,0 sebelumnya membuat check-out tanpa GPS TERLIHAT punya lokasi valid.
	lat: number | null;
	lng: number | null;
	accuracy: number | null;
	photoBlob: Blob | null;
	photoName: string | null;
	catatan: string | null;
	kegiatan: string | null;
	temuan: string | null;
	tindakLanjut: string | null;
	rencanaBesok: string | null;
	createdAt: string;
	// Peminjaman 09 §3.1 — DULU dibuang saat replay sehingga check-in offline tidak tertaut ke booking (pengembalian
	// ditolak G7). Opsional supaya entri lama di IndexedDB tetap valid.
	bookingId?: string | null;
	tipeKeperluan?: 'proyek' | 'marketing' | 'maintenance' | null;
}

const queue = createOfflineQueue<QueuedSiteCheckinSubmission>({
	dbName: 'epi_site_checkin_queue',
	storeName: 'pending_submissions',
	ordered: true,
	isRetryable: isRetryableError
});

export const enqueueSiteCheckinSubmission = queue.enqueue;
/** Entri 'pending' (atau tanpa status — entri lama), diurut createdAt. 'failed' TIDAK ikut. */
export const getQueuedSiteCheckinSubmissions = queue.getQueued;
export const removeQueuedSiteCheckinSubmission = queue.removeQueued;

/**
 * Kirim ulang semua check-in/out tertunda, BERURUTAN createdAt (Paket 02 §3.4) — berhenti
 * di kegagalan jaringan pertama supaya checkout tidak pernah dikirim mendahului check-in
 * pasangannya. sendFn (siteCheckinSync.ts) memanggil submitCheckin/submitCheckout
 * ($lib/services/siteCheckin.ts) sesuai `type`.
 */
export const flushSiteCheckinQueue = queue.flush;

/** Daftarkan auto-flush saat koneksi kembali online. Idempoten — aman dipanggil ulang. */
export const registerSiteCheckinAutoFlush = queue.registerAutoFlush;

/** Entri gagal PERMANEN (bukan jaringan) — untuk kartu "Coba lagi"/"Hapus" di UI. */
export const getFailedSiteCheckinSubmissions = queue.getFailed;
export const retryFailedSiteCheckinSubmission = queue.retryFailed;
export const markFailedSiteCheckinSubmission = queue.markFailed;
