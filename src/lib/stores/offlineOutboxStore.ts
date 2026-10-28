// src/lib/stores/offlineOutboxStore.ts
// Fase 4 (rencana "Package & Fitur Addons" §5) — UI Outbox global: satu badge yang
// menghitung SEMUA antrian offline sekaligus, bukan tiap halaman menampilkan
// jumlahnya sendiri-sendiri.
//
// KETERBATASAN DISENGAJA: store ini hanya MEMANTAU (hitung + navigasi ke halaman
// terkait), TIDAK bisa memicu kirim ulang (`flush`) langsung dari sini. Fungsi kirim
// sungguhan (`sendFn`) tiap antrian butuh logic khusus domain (upload foto, endpoint API,
// dsb) yang hidup di halaman masing-masing (lihat onMount tiap halaman konsumen) — bukan
// di modul antrian ini. Memaksakan tombol "kirim semua" generik di sini akan pura-pura
// berfungsi tanpa benar-benar memanggil API yang tepat. Solusi jujur: badge ini
// mengarahkan pengguna ke halaman terkait, tempat auto-flush (listener 'online') sudah
// terpasang.

import { writable } from 'svelte/store';
import { getQueue as getGenericQueue } from '$lib/utils/offlineQueue';
import { getQueuedSubmissions } from '$lib/utils/offlineStockQueue';
import { getQueuedAttendanceSubmissions } from '$lib/utils/offlineAttendanceQueue';
import { getQueuedComplaints } from '$lib/utils/offlineComplaintQueue';
import { getQueuedAsistenDrafts } from '$lib/utils/offlineAsistenDraftQueue';
import { getQueuedGRSubmissions } from '$lib/utils/offlineGRQueue';
import { getQueuedLemburSubmissions } from '$lib/utils/offlineLemburQueue';
import { getQueuedPeminjamanScans } from '$lib/utils/offlinePeminjamanQueue';
import { getQueuedPunchSubmissions } from '$lib/utils/offlinePunchQueue';
import { getQueuedSpkDailyLogs } from '$lib/utils/offlineSpkDailyQueue';
import { getQueuedSopConfirmations } from '$lib/utils/offlineSopCache';
import { getQueuedManpowerDokumen } from '$lib/utils/offlineManpowerDokumenQueue';
// L1 Offline Queue Enhancement (rencana Personal Admin Dashboard, 25 Agu 2026): 3 antrian ini
// sudah lama ada & sudah auto-flush di halaman masing-masing, tapi belum pernah didaftarkan di
// sini -- jumlahnya tidak pernah muncul di badge Outbox terpadu. offlineInternalChatQueue
// SENGAJA tidak ditambah: enqueue-nya tidak pernah dipanggil dari halaman manapun (fitur belum
// diintegrasikan), jadi selalu 0 dan menambahnya cuma menambah kode mati.
import { getQueuedSiteCheckinSubmissions } from '$lib/utils/offlineSiteCheckinQueue';
import { getQueuedCekArea } from '$lib/utils/offlineCekAreaQueue';
import { getQueuedPoUploads } from '$lib/utils/offlineSalesPoQueue';
import { getQueuedBiayaLapangan } from '$lib/utils/offlineBiayaLapanganQueue';
// Rekomendasi Tambahan Lapangan #3 (Offline Mode Enhancement, Pertajam Ciketing, 22 Sep 2026)
import { getQueuedTerimaBarangSubmissions } from '$lib/utils/offlineTerimaBarangQueue';
import { getQueuedLaporanHarianSubmissions } from '$lib/utils/offlineLaporanHarianQueue';
// Peminjaman 08 Fase B — P2H kendaraan (auto-flush global di layout lewat P2HQueueSync.svelte)
import { getQueuedP2H } from '$lib/utils/offlineP2HQueue';
// Penajaman Gate SJ — Offline Proof Buffer foto SJ fisik (auto-flush global lewat ScanSjQueueSync.svelte)
import { getQueuedScanSj } from '$lib/utils/offlineScanSjQueue';

export interface OutboxEntry {
	key: string;
	label: string;
	route: string;
	count: number;
}

export interface OutboxState {
	total: number;
	entries: OutboxEntry[];
	loading: boolean;
}

const SOURCES: { key: string; label: string; route: string; getQueued: () => Promise<unknown[]> | unknown[] }[] = [
	{ key: 'generic', label: 'Submit tertunda (umum)', route: '/', getQueued: getGenericQueue },
	{ key: 'stock', label: 'Stock Lapangan', route: '/stock-lapangan', getQueued: getQueuedSubmissions },
	{ key: 'attendance', label: 'Absensi', route: '/ess/absen', getQueued: getQueuedAttendanceSubmissions },
	{ key: 'complaint', label: 'Komplain Customer', route: '/komplain-customer', getQueued: getQueuedComplaints },
	{ key: 'asisten', label: 'Draf Asisten AI', route: '/', getQueued: getQueuedAsistenDrafts },
	{ key: 'gr', label: 'Goods Received', route: '/stock-lapangan/masuk', getQueued: getQueuedGRSubmissions },
	{ key: 'lembur', label: 'Pengajuan Lembur', route: '/ess/lembur/baru', getQueued: getQueuedLemburSubmissions },
	{ key: 'peminjaman', label: 'Peminjaman External', route: '/', getQueued: getQueuedPeminjamanScans },
	{ key: 'punch', label: 'Punch List QC', route: '/', getQueued: getQueuedPunchSubmissions },
	{ key: 'spkDaily', label: 'Produksi Harian', route: '/produksi/input-harian', getQueued: getQueuedSpkDailyLogs },
	{ key: 'sop', label: 'Konfirmasi SOP', route: '/ess/pelatihan/sop', getQueued: getQueuedSopConfirmations },
	{ key: 'manpowerDokumen', label: 'Dokumen Manpower', route: '/manpower', getQueued: getQueuedManpowerDokumen },
	{ key: 'siteCheckin', label: 'Site Check-in/out', route: '/site-checkin', getQueued: getQueuedSiteCheckinSubmissions },
	{ key: 'cekArea', label: 'Cek Area/Genba', route: '/stock-lapangan', getQueued: getQueuedCekArea },
	{ key: 'salesPo', label: 'Upload PO Customer', route: '/sales/po', getQueued: getQueuedPoUploads },
	{ key: 'biayaLapangan', label: 'Biaya Lapangan', route: '/biaya-lapangan', getQueued: getQueuedBiayaLapangan },
	{ key: 'wsTerimaBarang', label: 'Terima Barang Workshop', route: '/workshop', getQueued: getQueuedTerimaBarangSubmissions },
	{ key: 'wsLaporanHarian', label: 'Laporan Harian Workshop', route: '/workshop', getQueued: getQueuedLaporanHarianSubmissions },
	{ key: 'p2h', label: 'P2H Kendaraan', route: '/ess/kendaraan', getQueued: getQueuedP2H },
	{ key: 'scanSj', label: 'Foto SJ Fisik', route: '/lacak-sj', getQueued: getQueuedScanSj }
];

export const offlineOutbox = writable<OutboxState>({ total: 0, entries: [], loading: false });

let refreshInFlight: Promise<void> | null = null;

export async function refreshOutboxCounts(): Promise<void> {
	if (refreshInFlight) return refreshInFlight;
	offlineOutbox.update((s) => ({ ...s, loading: true }));
	refreshInFlight = (async () => {
		const results = await Promise.all(
			SOURCES.map(async (src) => {
				try {
					const queued = await src.getQueued();
					return { key: src.key, label: src.label, route: src.route, count: queued.length };
				} catch {
					return { key: src.key, label: src.label, route: src.route, count: 0 };
				}
			})
		);
		const entries = results.filter((e) => e.count > 0);
		const total = entries.reduce((sum, e) => sum + e.count, 0);
		offlineOutbox.set({ total, entries, loading: false });
	})();
	try {
		await refreshInFlight;
	} finally {
		refreshInFlight = null;
	}
}

let listenersRegistered = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/** Panggil sekali di root layout. Memasang polling ringan + listener online/visibility. */
export function initOfflineOutboxWatcher(): () => void {
	refreshOutboxCounts();

	if (typeof window === 'undefined') return () => {};

	if (!listenersRegistered) {
		listenersRegistered = true;
		window.addEventListener('online', () => refreshOutboxCounts());
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') refreshOutboxCounts();
		});
	}

	if (!pollTimer) {
		// Polling ringan (bukan real-time) — cukup untuk badge, jangan bikin baterai HP boros.
		pollTimer = setInterval(() => refreshOutboxCounts(), 30_000);
	}

	return () => {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	};
}
