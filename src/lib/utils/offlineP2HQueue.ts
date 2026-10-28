// src/lib/utils/offlineP2HQueue.ts
// Peminjaman 08 Fase B — antrean offline P2H (checklist sebelum pakai / pengembalian). P2H sering diisi di
// basement/pool tanpa sinyal: tanpa antrean peminjam tertahan di pool, atau berangkat tanpa P2H tercatat.
//
// Keputusan Lead: setelah tersimpan di HP peminjam LANGSUNG boleh berangkat/pulang — UI memperlakukan booking
// sebagai aktif/selesai (overlay, lihat getPendingP2HOverlay); server mengaktifkan/menutup booking saat antrean
// terkirim, memakai waktu kejadian dari HP (`client_created_at`, ≤ 24 jam).
//
// Reuse createOfflineQueue() (offlineQueueFactory.ts) untuk penyimpanan IndexedDB, TAPI flush ditulis sendiri:
//  - factory.flush mengirim menurut urutan key (uuid acak), padahal "sebelum" HARUS terkirim mendahului "setelah";
//  - factory.flush mengulang error permanen (4xx) selamanya. Di sini entri yang ditolak server ditandai `rejected`
//    (+ pesan) dan tidak diulang; peminjam melihatnya dan bisa membuangnya.
// Idempotensi dijamin server lewat client_txn_id, jadi mengirim ulang setelah "sinyal putus di tengah" aman.

import { get } from 'svelte/store';
import { authStore } from '$lib/stores/auth';
import { createOfflineQueue } from './offlineQueueFactory';
import { isNetworkError } from './fetchTimeout';
import { submitFleetChecklist, type ChecklistItemInput } from '$lib/services/ess/fleetBooking';

export interface QueuedP2HSubmission {
	client_txn_id: string;
	bookingId: string;
	tahap: 'sebelum' | 'setelah';
	items: ChecklistItemInput[];
	kmSaatCek: number;
	temuan: string | null;
	kmKoreksiAlasan: string | null;
	lupaSebelum: boolean;
	fotoBlob: Blob | null;
	fotoName: string | null;
	fotoDashboardBlob: Blob | null;
	createdAt: string;
	/** uid pengantre — hanya dikirim oleh akun yang sama (HP bisa dipakai bergantian). */
	userId: string;
	status?: 'pending' | 'rejected';
	lastError?: string | null;
	attempts?: number;
}

const queue = createOfflineQueue<QueuedP2HSubmission>({
	dbName: 'epi_p2h_queue',
	storeName: 'pending_p2h'
});

export const enqueueP2H = queue.enqueue;
export const getQueuedP2H = queue.getQueued;
export const removeQueuedP2H = queue.removeQueued;

export const currentP2HUserId = () => get(authStore).user?.uid || 'anon';

// ───────────────────────── logika murni (diuji di offlineP2HQueue.test.ts) ─────────────────────────

/** Urutan kirim: hanya entri milik user & belum ditolak, menurut waktu antre (sebelum selalu lebih dulu dari setelah). */
export function planFlushOrder(entries: QueuedP2HSubmission[], userId: string): QueuedP2HSubmission[] {
	return entries
		.filter((e) => e.userId === userId && e.status !== 'rejected')
		.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export type SendOutcome = 'sent' | 'transient' | 'rejected';

/** 'transient' = coba lagi nanti (jaringan/5xx/408/429); 'rejected' = server menolak permanen (4xx lain). */
export function classifyError(err: unknown): SendOutcome {
	if (isNetworkError(err)) return 'transient';
	const status = Number((err as { status?: number })?.status);
	if (!Number.isFinite(status)) return 'transient'; // tidak diketahui → jangan buang data peminjam
	if (status >= 500 || status === 408 || status === 429) return 'transient';
	if (status >= 400) return 'rejected';
	return 'transient';
}

/** Overlay tampilan: booking dengan P2H tertunda dianggap sudah aktif/selesai (setelah mengalahkan sebelum). */
export function buildOverlay(entries: QueuedP2HSubmission[], userId: string): Map<string, 'sebelum' | 'setelah'> {
	const map = new Map<string, 'sebelum' | 'setelah'>();
	for (const e of entries) {
		if (e.userId !== userId || e.status === 'rejected') continue;
		if (e.tahap === 'setelah' || !map.has(e.bookingId)) map.set(e.bookingId, e.tahap);
	}
	return map;
}

// ───────────────────────── pengiriman ─────────────────────────

const asFile = (blob: Blob | null, name: string | null, fallback: string): File | null =>
	blob ? new File([blob], name || fallback, { type: blob.type || 'image/jpeg' }) : null;

async function sendOne(entry: QueuedP2HSubmission): Promise<void> {
	await submitFleetChecklist({
		bookingId: entry.bookingId,
		tahap: entry.tahap,
		items: entry.items,
		kmSaatCek: entry.kmSaatCek,
		temuan: entry.temuan || undefined,
		foto: asFile(entry.fotoBlob, entry.fotoName, 'foto.jpg'),
		fotoDashboard: asFile(entry.fotoDashboardBlob, 'dashboard.jpg', 'dashboard.jpg'),
		clientTxnId: entry.client_txn_id,
		kmKoreksiAlasan: entry.kmKoreksiAlasan || undefined,
		lupaSebelum: entry.lupaSebelum,
		clientCreatedAt: entry.createdAt
	});
}

let flushing: Promise<{ sent: number; rejected: number; remaining: number }> | null = null;

/**
 * Kirim antrean P2H milik user saat ini, berurutan. Berhenti di error sementara (jaringan/5xx) supaya urutan
 * tidak terbalik; entri yang ditolak permanen ditandai `rejected` dan entri lain untuk booking yang sama dilewati.
 */
export function flushP2HQueue(): Promise<{ sent: number; rejected: number; remaining: number }> {
	if (flushing) return flushing;
	flushing = (async () => {
		let sent = 0;
		let rejected = 0;
		const all = await queue.getQueued();
		const plan = planFlushOrder(all, currentP2HUserId());
		const blockedBookings = new Set<string>();
		let stop = false;
		for (const entry of plan) {
			if (stop) break;
			if (blockedBookings.has(entry.bookingId)) continue;
			try {
				await sendOne(entry);
				await queue.removeQueued(entry.client_txn_id);
				sent++;
			} catch (e) {
				const outcome = classifyError(e);
				if (outcome === 'rejected') {
					rejected++;
					blockedBookings.add(entry.bookingId);
					await queue
						.enqueue({ ...entry, status: 'rejected', lastError: (e as Error)?.message || 'Ditolak server', attempts: (entry.attempts || 0) + 1 })
						.catch((qe) => console.error('[offlineP2HQueue] gagal menandai entri ditolak:', qe));
				} else {
					console.warn('[offlineP2HQueue] pengiriman tertunda (sementara):', (e as Error)?.message || e);
					stop = true;
				}
			}
		}
		const remaining = planFlushOrder(await queue.getQueued(), currentP2HUserId()).length;
		return { sent, rejected, remaining };
	})().finally(() => {
		flushing = null;
	});
	return flushing;
}

/** P2H milik user yang ditolak server saat sinkron (untuk banner + tombol Buang). */
export async function getRejectedP2H(): Promise<QueuedP2HSubmission[]> {
	const uid = currentP2HUserId();
	return (await queue.getQueued()).filter((e) => e.userId === uid && e.status === 'rejected');
}

export async function getPendingP2HOverlay(): Promise<Map<string, 'sebelum' | 'setelah'>> {
	return buildOverlay(await queue.getQueued(), currentP2HUserId());
}

/** Jumlah P2H tertunda milik user (badge Outbox menghitung semuanya lewat getQueuedP2H). */
export async function countPendingP2H(): Promise<number> {
	return planFlushOrder(await queue.getQueued(), currentP2HUserId()).length;
}

/** Pasang auto-flush saat koneksi kembali. Kembalikan fungsi pelepas. Panggil sekali (layout). */
export function registerP2HAutoFlush(onFlushed?: (r: { sent: number; rejected: number; remaining: number }) => void): () => void {
	if (typeof window === 'undefined') return () => {};
	const run = () => {
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
		flushP2HQueue()
			.then((r) => {
				if (r.sent > 0 || r.rejected > 0) window.dispatchEvent(new CustomEvent('p2h-queue-flushed', { detail: r }));
				onFlushed?.(r);
			})
			.catch((e) => console.error('[offlineP2HQueue] flush gagal:', e));
	};
	window.addEventListener('online', run);
	run(); // aplikasi baru dibuka saat sudah online: event 'online' tidak akan terpicu
	return () => window.removeEventListener('online', run);
}
