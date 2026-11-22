// src/lib/utils/offlineReportEventQueue.ts
// Report Center Fase 6 (offline) — antrean pencatatan event laporan saat perangkat tak punya sinyal.
// Hanya KEGAGALAN JARINGAN (fetch melempar) yang diantre; jawaban server apa pun (termasuk 202 "belum tercatat")
// dianggap selesai agar antrean tidak menumpuk bila koleksi report_events belum dibuat. Event bersifat append-only
// tanpa kunci unik di server, jadi replay yang responsnya hilang dapat menghasilkan satu duplikat — dapat diterima
// untuk statistik penggunaan (bukan data transaksi). Dibatasi MAX_QUEUE entri; yang terlama dibuang.

import { createOfflineQueue, type OfflineQueueEntryBase } from './offlineQueueFactory';

export interface QueuedReportEvent extends OfflineQueueEntryBase {
	client_txn_id: string;
	createdAt: string;
	body: Record<string, unknown>;
}

export const MAX_QUEUE = 200;

const queue = createOfflineQueue<QueuedReportEvent>({
	dbName: 'epi_report_event_queue',
	storeName: 'pending_events',
	ordered: true
});

export const getQueuedReportEvents = queue.getQueued;
export const flushReportEventQueue = queue.flush;
export const registerReportEventAutoFlush = queue.registerAutoFlush;

/** Antre satu event; jaga batas MAX_QUEUE dengan membuang yang paling lama. Tidak pernah melempar. */
export async function enqueueReportEvent(body: Record<string, unknown>): Promise<void> {
	try {
		const existing = await queue.getQueued(); // sudah terurut createdAt
		const overflow = existing.length + 1 - MAX_QUEUE;
		for (let i = 0; i < overflow; i++) await queue.removeQueued(existing[i].client_txn_id);
		await queue.enqueue({
			client_txn_id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `rev-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			createdAt: new Date().toISOString(),
			body
		});
	} catch (e: any) {
		console.warn('[offlineReportEventQueue] gagal mengantre (non-fatal):', e?.message);
	}
}
