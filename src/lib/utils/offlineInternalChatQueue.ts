// src/lib/utils/offlineInternalChatQueue.ts
// Fase 5 (Rekomendasi #5 Lapangan, Rendah) — Offline Chat Queue: pesan chat internal
// yang ditulis saat offline diantre lokal, auto-flush saat online kembali. Reuse
// offlineQueueFactory.ts (pola sama dengan offlineAsistenDraftQueue.ts).
//
// CATATAN JUJUR: `internal_chat_messages` TIDAK punya kolom idempotency (beda dari
// draft requisition/WO yang punya marker "[txn:<id>]"). Risiko duplikat kalau
// request SEBENARNYA sukses di server tapi respons terputus sebelum sampai ke klien
// tetap ada saat retry — untuk pesan chat teks ini dianggap risiko rendah/dapat
// diterima (user bisa lihat & abaikan duplikat), TIDAK sepadan menambah kolom
// unique baru untuk fitur prioritas Rendah ini.
import { createOfflineQueue } from './offlineQueueFactory';

export interface QueuedInternalChatMessage {
	client_txn_id: string;
	roomId: number;
	senderUid: string;
	senderName: string;
	content: string;
	createdAt: string;
}

const queue = createOfflineQueue<QueuedInternalChatMessage>({
	dbName: 'epi_internal_chat_queue',
	storeName: 'pending_messages'
});

export const enqueueInternalChatMessage = queue.enqueue;
export const getQueuedInternalChatMessages = queue.getQueued;
export const removeQueuedInternalChatMessage = queue.removeQueued;
export const flushInternalChatQueue = queue.flush;
export const registerInternalChatAutoFlush = queue.registerAutoFlush;
