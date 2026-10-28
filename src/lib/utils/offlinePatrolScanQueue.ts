// src/lib/utils/offlinePatrolScanQueue.ts
// R1 (Kontrol Patroli, rekomendasi lapangan, 15 Sep 2026) — antrian offline untuk submit
// checklist pos/scan checkpoint patroli. Dibangun lewat createOfflineQueue()
// (offlineQueueFactory.ts), sama pola dengan offlineCekAreaQueue.ts dkk. Area patroli
// outdoor sering kehilangan sinyal — submit yang gagal karena jaringan (bukan ditolak
// server) disimpan lengkap (termasuk File foto & tanda tangan) dan dikirim ulang
// otomatis saat online, atau manual lewat tombol "Kirim Ulang Antrian".

import { createOfflineQueue } from './offlineQueueFactory';

export interface QueuedPatrolSubmission {
	client_txn_id: string;
	patrol_log_id: number;
	checkpoint_id: number;
	checkpoint_code: string;
	checkpoint_name: string;
	route_id: number | null;
	template_id: number | null;
	responses: { item_id: number; answer: 'yes' | 'no' | 'na'; notes?: string }[] | null;
	signature: string | null;
	checklist_photos: Record<number, File>;
	scan_foto: File | null;
	kondisi: string;
	catatan: string | undefined;
	lat: number | null;
	lng: number | null;
	in_radius: boolean;
	override_reason: string | null;
	ruangan_cek_skip_reason: string | undefined;
	/** Two-Tap kebersihan (Fase 2): bila diisi, ini Tap 2 (Selesai Kerja) — update baris scan ini, bukan buat baru. */
	dwell_scan_id: number | null;
	dwell_override_reason: string | null;
	queued_at: number;
}

const queue = createOfflineQueue<QueuedPatrolSubmission>({
	dbName: 'epi_patrol_scan_queue',
	storeName: 'pending_patrol_submission'
});

export const enqueuePatrolSubmission = queue.enqueue;
export const getQueuedPatrolSubmissions = queue.getQueued;
export const removeQueuedPatrolSubmission = queue.removeQueued;
export const flushPatrolSubmissionQueue = queue.flush;
export const registerPatrolSubmissionAutoFlush = queue.registerAutoFlush;
