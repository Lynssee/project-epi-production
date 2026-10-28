// src/lib/utils/offlineKioskProduksiQueue.ts
// R7 (rekomendasi audit "Pertajam Modul Kiosk Produksi v2", 12 Sep 2026) — mode offline nyata
// untuk kiosk/input-produksi. Membalik keputusan arsitektur "online_only" (Fase 2, 24 Agu 2026)
// KHUSUS halaman ini, atas konfirmasi eksplisit Lead — lihat catatan di kiosk/+layout.svelte.
//
// Urutan wajib setelah Bug 4 (Fase 1, idempotensi submit): `client_txn_id` di spk_daily_log
// sudah unique DAN dibuat sekali oleh klien saat SPK dipilih (bukan server), jadi retry dari
// antrian ini aman by construction, sama seperti offlinePunchQueue.ts.
//
// Pola sama persis antrian offline lain (createOfflineQueue, offlineQueueFactory.ts).

import { createOfflineQueue, PermanentQueueError } from './offlineQueueFactory';

export { PermanentQueueError };

export interface QueuedProduksiSubmission {
	client_txn_id: string;
	spkId: number;
	outputKg: number;
	rejectKg: number;
	wasteKg: number;
	catatan: string | null;
	rejectReasons: string[] | null;
	wasteReasons: string[] | null;
	markComplete: boolean;
	jadwalKerjaIdOverride: string | null;
	equipmentId: string | null;
	createdAt: string;
}

const queue = createOfflineQueue<QueuedProduksiSubmission>({
	dbName: 'epi_kiosk_produksi_queue',
	storeName: 'pending_submissions'
});

export const enqueueProduksiSubmission = queue.enqueue;
export const getQueuedProduksiSubmissions = queue.getQueued;
export const removeQueuedProduksiSubmission = queue.removeQueued;

/** Kirim ulang semua entri tertunda. Yang berhasil dihapus dari antrian; yang gagal tetap tersimpan. */
export const flushProduksiQueue = queue.flush;

/** Daftarkan auto-flush saat koneksi kembali online. Panggil sekali di kiosk/input-produksi.
 *  Mengembalikan fungsi unregister — WAJIB dipanggil di onDestroy (§3.7 item 4). */
export const registerProduksiAutoFlush = queue.registerAutoFlush;

// File 03 §3.7 item 3 — entri yang GAGAL PERMANEN (SPK sudah ditutup dsb.) disimpan terpisah
// di localStorage (bukan IndexedDB antrean aktif) supaya tetap terlihat ke operator/supervisor
// sampai ditunjukkan, walau operator berpindah halaman atau me-refresh.
const GAGAL_STORAGE_KEY = 'epi_kiosk_produksi_gagal';

export interface GagalProduksiEntry {
	client_txn_id: string;
	spkId: number;
	outputKg: number;
	alasan: string;
	waktu: string;
}

export function recordGagalPermanen(entries: { client_txn_id: string; spkId: number; outputKg: number }[], alasan: string): void {
	if (typeof localStorage === 'undefined' || entries.length === 0) return;
	try {
		const existing = getGagalPermanenEntries();
		const tambahan: GagalProduksiEntry[] = entries.map((e) => ({ ...e, alasan, waktu: new Date().toISOString() }));
		localStorage.setItem(GAGAL_STORAGE_KEY, JSON.stringify([...existing, ...tambahan]));
	} catch {
		/* non-fatal — localStorage penuh/tidak tersedia, entri tetap dianggap gagal secara diam-diam */
	}
}

export function getGagalPermanenEntries(): GagalProduksiEntry[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(GAGAL_STORAGE_KEY);
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
}

export function clearGagalPermanenEntry(clientTxnId: string): void {
	if (typeof localStorage === 'undefined') return;
	try {
		const sisa = getGagalPermanenEntries().filter((e) => e.client_txn_id !== clientTxnId);
		localStorage.setItem(GAGAL_STORAGE_KEY, JSON.stringify(sisa));
	} catch {
		/* non-fatal */
	}
}
