// src/lib/utils/offlineAttendanceQueue.ts
// Antrian offline untuk capture liveness+GPS absensi ESS Fase 1 (situs sinyal buruk).
// Fase 4 konsolidasi (rencana "Package & Fitur Addons" §5) — implementasi internal
// sekarang createOfflineQueue() (offlineQueueFactory.ts), export tetap sama persis
// supaya konsumen (ess/absen) tidak perlu diubah.
//
// Catatan idempotency: absensi_harian TIDAK punya kolom unique client_txn_id (beda dari
// stock_transactions) — clock-in/out sendiri sudah upsert per (karyawan_id, tanggal) dan
// menolak 409 bila jam_masuk/jam_keluar sudah terisi. Konsekuensinya: sendFn yang
// dipakai flushAttendanceQueue WAJIB menganggap 409 "sudah absen ..." sebagai sukses
// (punch sebelumnya sudah tercatat), bukan kegagalan — supaya retry tidak nyangkut.
// (Logic ini ada di sendFn milik pemanggil, bukan di file ini — lihat services/ess/attendance.ts.)

import { createOfflineQueue } from './offlineQueueFactory';

export type AttendancePunchType = 'clock_in' | 'clock_out' | 'break_out' | 'break_in';

export interface QueuedAttendanceSubmission {
	client_txn_id: string;
	type: AttendancePunchType;
	lat: number;
	lng: number;
	accuracy: number | null;
	lokasiAbsensiId: string | null;
	// photoBlob kosong (size 0) diperbolehkan untuk break_out saat foto tidak diwajibkan.
	photoBlob: Blob;
	photoName: string;
	livenessPassed: boolean;
	kategoriId: string | null;
	// Fase 2 (rencana absensi istirahat v2 §3.2) — mode "istirahat di perjalanan", opsional
	// (default false bila entry lama dari sebelum field ini ada, lihat sendQueuedPunch).
	perjalanan?: boolean;
	// Fase 3 (rencana absensi istirahat v2 §3.1) — payload Dynamic Screen QR meja desk, opsional.
	wstnPayload?: string | null;
	// Fase 2 §5 — koreksi chip konteks lokasi sebelum submit, opsional.
	konteksOverride?: string | null;
	createdAt: string;
}

const queue = createOfflineQueue<QueuedAttendanceSubmission>({
	dbName: 'epi_attendance_queue',
	storeName: 'pending_punches'
});

export const enqueueAttendanceSubmission = queue.enqueue;
export const getQueuedAttendanceSubmissions = queue.getQueued;
export const removeQueuedAttendanceSubmission = queue.removeQueued;

/**
 * Kirim ulang semua punch tertunda. sendFn bertanggung jawab memanggil clockIn/clockOut
 * (lihat src/lib/services/ess/attendance.ts) dan HARUS menelan 409 "sudah absen..."
 * sebagai sukses (lihat catatan idempotency di atas). Yang berhasil dihapus dari
 * antrian; yang gagal (mis. masih offline) tetap tersimpan untuk percobaan berikutnya.
 */
export const flushAttendanceQueue = queue.flush;

/** Daftarkan auto-flush saat koneksi kembali online. Panggil sekali di halaman ess/absen. */
export const registerAttendanceAutoFlush = queue.registerAutoFlush;
