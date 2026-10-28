// src/lib/utils/siteCheckinSync.ts
// Paket 02 Site Visit Release (docs/(analyst) site visit/02_offline-idempotensi.md §3.5) —
// sinkronisasi GLOBAL antrean site check-in, dipanggil sekali di root layout (bukan hanya
// saat halaman /site-checkin terbuka — sebelumnya antrean hanya terkirim kalau user membuka
// halaman itu lagi setelah sinyal kembali, worst case D di dokumen).
//
// Pemicu flush: mount aplikasi, event 'online', tab kembali terlihat (visibilitychange),
// dan interval 60 dtk HANYA BILA ada entri pending (hemat baterai/API — tidak polling terus).

import {
	flushSiteCheckinQueue,
	getQueuedSiteCheckinSubmissions,
	type QueuedSiteCheckinSubmission
} from './offlineSiteCheckinQueue';
import { submitCheckin, submitCheckout } from '$lib/services/siteCheckin';
import { checkInVisit, submitVisit, submitVisitByTxn } from '$lib/services/sales';

/** Event global — komponen (JourneyTimeline, +page site-checkin, dll) dengar ini untuk
 *  refresh tampilan setelah antrean berhasil terkirim, dari halaman mana pun. */
export const SITE_CHECKIN_CHANGED_EVENT = 'site-checkin:changed';

function toPhotoFile(entry: QueuedSiteCheckinSubmission): File | null {
	if (!entry.photoBlob) return null;
	return new File([entry.photoBlob], entry.photoName || 'photo.jpg', {
		type: entry.photoBlob.type || 'image/jpeg'
	});
}

/**
 * Kirim satu entri antrean. Dipanggil oleh factory (flushSiteCheckinQueue), berurutan
 * createdAt, berhenti di kegagalan jaringan pertama (lihat offlineQueueFactory ordered:true).
 */
export async function sendQueuedSiteCheckin(entry: QueuedSiteCheckinSubmission): Promise<void> {
	const photoFile = toPhotoFile(entry);

	if (entry.type === 'checkin' && entry.extra?.jalur === 'sales') {
		// Paket 08c §5.3 — jalur sales (/sales/baru): target ada di extra (bukan referensiId),
		// dikirim ke /api/sales/visit/checkin (bukan /api/site-checkin seperti tipe proyek).
		const targetType = entry.extra.target_type;
		const targetId = Number(entry.extra.target_id);
		if (!targetId || (targetType !== 'customer' && targetType !== 'prospect')) {
			throw new Error('Entri check-in sales tanpa target customer/prospek — data cacat, tidak bisa dikirim.');
		}
		await checkInVisit({
			customerId: targetType === 'customer' ? targetId : null,
			prospectId: targetType === 'prospect' ? targetId : null,
			tujuan: entry.extra.tujuan || 'Kunjungan lapangan',
			latitude: entry.lat ?? 0,
			longitude: entry.lng ?? 0,
			accuracy: entry.accuracy,
			fotoFile: photoFile,
			clientCreatedAt: entry.createdAt,
			clientTxnId: entry.client_txn_id
		});
		return;
	}

	if (entry.type === 'checkin') {
		if (!entry.referensiId) throw new Error('Entri check-in tanpa referensiId — data cacat, tidak bisa dikirim.');
		await submitCheckin({
			referensiId: entry.referensiId,
			// Check-in SELALU punya GPS nyata (form memblokir submit tanpa lokasi).
			lat: entry.lat ?? 0,
			lng: entry.lng ?? 0,
			accuracy: entry.accuracy,
			photoFile: photoFile as File, // form memblokir submit tanpa foto — lihat catatan sama di atas
			catatan: entry.catatan || undefined,
			bookingId: entry.bookingId || undefined,
			tipeKeperluan: entry.tipeKeperluan || 'proyek',
			// SV-12: waktu check-in SEBENARNYA (saat masuk antrean), bukan waktu flush/sinkron.
			clientCreatedAt: entry.createdAt,
			// SV-12: dedup exact-match — replay (retry setelah gagal dapat respons) mengembalikan
			// baris yang sama, bukan duplikat baru.
			clientTxnId: entry.client_txn_id
		});
		return;
	}

	if (entry.type === 'checkout' && entry.extra?.jalur === 'sales') {
		// Paket 08c §5.3 — submit hasil kunjungan sales offline. Dua kasus:
		//  1. extra.visit_id terisi — kunjungan sudah tersinkron saat form dibuka (visit.id
		//     diketahui), hanya SUBMIT-nya yang gagal/offline. Kirim lewat submitVisit() biasa.
		//  2. extra.visit_id kosong — kunjungan dimulai OFFLINE juga (resume dari
		//     /sales/offline/{txn}); visitId belum ada, resolve via checkinClientTxnId di server
		//     (submit-by-txn, 425 retryable bila check-in pasangannya belum tersinkron).
		const statusBant = entry.extra.status_bant ? JSON.parse(entry.extra.status_bant) : null;
		const params = {
			hasilKunjungan: entry.extra.hasil_kunjungan || '',
			followUpDate: entry.extra.follow_up_date || null,
			nextAction: entry.extra.next_action || null,
			fotoFile: photoFile,
			kegiatan: entry.extra.kegiatan || '',
			lat: entry.lat,
			lng: entry.lng,
			accuracy: entry.accuracy,
			picDitemui: entry.extra.pic_ditemui || null,
			jabatanPic: entry.extra.jabatan_pic || null,
			noWaPic: entry.extra.no_wa_pic || null,
			statusBant,
			clientTxnId: entry.client_txn_id
		};
		if (entry.extra.visit_id) {
			await submitVisit(Number(entry.extra.visit_id), params);
		} else if (entry.checkinClientTxnId) {
			await submitVisitByTxn(entry.checkinClientTxnId, params);
		} else {
			throw new Error('Entri submit sales tanpa visit_id maupun checkinClientTxnId — data cacat.');
		}
		return;
	}

	// checkout
	if (!entry.checkinId && !entry.checkinClientTxnId) {
		// Data cacat — tidak seharusnya bisa terjadi dari titik enqueue manapun (keduanya
		// selalu diisi salah satu). Error jelas, bukan salah kirim diam-diam.
		throw new Error('Entri checkout tanpa checkinId maupun checkinClientTxnId — data cacat.');
	}
	await submitCheckout({
		// Paket 02 §3.9.2 (worst case I): checkout diantrekan SEBELUM check-in pasangannya
		// (yang juga masih di antrean, atau baru saja dikirim di flush ini) dikonfirmasi
		// server — checkinId kosong, server me-resolve dari checkinClientTxnId. Bila belum
		// ketemu (check-in belum benar-benar tersinkron), server balas 425 (retryable) —
		// entri INI tetap di antrean, dicoba lagi flush berikutnya; urutan createdAt
		// (factory ordered:true) menjamin check-in SELALU dicoba sebelum checkout ini.
		checkinId: entry.checkinId || '',
		checkinClientTxnId: entry.checkinId ? null : entry.checkinClientTxnId,
		lat: entry.lat,
		lng: entry.lng,
		accuracy: entry.accuracy,
		photoFile,
		kegiatan: entry.kegiatan || undefined,
		temuan: entry.temuan || undefined,
		tindakLanjut: entry.tindakLanjut || undefined,
		rencanaBesok: entry.rencanaBesok || undefined,
		// Paket 02 §3.9 — waktu checkout SEBENARNYA + dedup replay, pola sama check-in.
		clientCreatedAt: entry.createdAt,
		clientTxnId: entry.client_txn_id
	});
}

let started = false;
let intervalId: ReturnType<typeof setInterval> | undefined;

async function flushIfAny() {
	const pending = await getQueuedSiteCheckinSubmissions();
	if (pending.length === 0) return;
	const result = await flushSiteCheckinQueue(sendQueuedSiteCheckin);
	if (result.sent > 0 && typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent(SITE_CHECKIN_CHANGED_EVENT));
	}
}

/**
 * Aktifkan sinkronisasi global — panggil SEKALI di root layout setelah auth siap. Idempoten:
 * panggilan berikutnya (mis. re-mount layout) tidak mendaftarkan listener kedua kalinya.
 */
export function startSiteCheckinSync(): void {
	if (started || typeof window === 'undefined') return;
	started = true;

	// Coba kirim langsung saat sinkronisasi diaktifkan (mis. aplikasi baru dibuka, sudah
	// online) — tidak menunggu event 'online' yang mungkin tidak pernah terpicu kalau
	// jaringan sudah tersedia sejak awal.
	flushIfAny().catch(() => {});

	window.addEventListener('online', () => {
		flushIfAny().catch(() => {});
	});

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') flushIfAny().catch(() => {});
	});

	// Interval hemat baterai/API — HANYA benar-benar flush kalau ada entri pending
	// (getQueuedSiteCheckinSubmissions dicek duluan di flushIfAny, bukan flush buta tiap 60 dtk).
	intervalId = setInterval(() => {
		flushIfAny().catch(() => {});
	}, 60_000);
}

/** Untuk pengujian/pembersihan (mis. HMR) — TIDAK dipanggil dari kode aplikasi normal. */
export function _resetSiteCheckinSyncForTest(): void {
	started = false;
	if (intervalId) clearInterval(intervalId);
	intervalId = undefined;
}
