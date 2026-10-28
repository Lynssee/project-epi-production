// src/lib/utils/offlineAsistenDraftQueue.ts
// Antrian offline untuk konfirmasi draf Asisten AI (5B#5 Offline queue,
// implementation_plan_asisten_ai_v2.md). Fase 4 konsolidasi (rencana "Package & Fitur
// Addons" §5) — implementasi internal sekarang createOfflineQueue()
// (offlineQueueFactory.ts), export tetap sama persis supaya konsumen (AsistenSheet.svelte)
// tidak perlu diubah.
//
// LINGKUP SENGAJA SEMPIT: hanya mengantre KONFIRMASI draf (POST /api/ai-assistant/
// draft-requisition atau draft-maintenance-ticket) — BUKAN percakapan chat itu
// sendiri. Chat butuh koneksi live ke LLM (tool-calling, streaming); tidak ada
// versi "offline" yang masuk akal untuk itu.
//
// Idempotency: requisition/work_order TIDAK punya kolom unik seperti
// project_punch_list.client_txn_id — client_txn_id dikirim ke server dan dicek
// lewat marker "[txn:<id>]" di field teks yang sudah ada (lihat kedua endpoint
// draft-*), bukan skema baru. Jadi retry (baik auto-flush maupun manual) aman
// walau percobaan SEBELUMNYA sebenarnya sudah sukses di server tapi responsnya
// tak sempat sampai ke klien.

import { createOfflineQueue } from './offlineQueueFactory';

export interface QueuedAsistenDraft {
	client_txn_id: string;
	kind: 'requisition' | 'maintenance_ticket';
	endpoint: string; // '/api/ai-assistant/draft-requisition' | '/api/ai-assistant/draft-maintenance-ticket'
	body: Record<string, unknown>; // body request, SUDAH termasuk client_txn_id
	label: string; // ringkasan untuk ditampilkan di UI, mis. "Requisition: 5 unit sarung tangan"
	createdAt: string;
}

const queue = createOfflineQueue<QueuedAsistenDraft>({
	dbName: 'epi_asisten_draft_queue',
	storeName: 'pending_drafts'
});

export const enqueueAsistenDraft = queue.enqueue;
export const getQueuedAsistenDrafts = queue.getQueued;
export const removeQueuedAsistenDraft = queue.removeQueued;

/** Kirim ulang semua draf tertunda. Yang berhasil (termasuk replay idempotent) dihapus; yang gagal tetap tersimpan. */
export const flushAsistenDraftQueue = queue.flush;

/** Daftarkan auto-flush saat koneksi kembali online. Panggil sekali di AsistenSheet.svelte. */
export const registerAsistenDraftAutoFlush = queue.registerAutoFlush;
