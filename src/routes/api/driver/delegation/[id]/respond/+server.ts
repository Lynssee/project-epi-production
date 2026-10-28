import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateDriver } from '$lib/server/driver/driverGuard';
import { directusServerJson } from '$lib/server/directus';
import { evaluateBerangkat, sjButuhSatpam } from '$lib/server/driver/berangkatGuard';
import { recordKioskTrackingEvent } from '$lib/server/sjTracking';

// Driver Terima/Tolak delegasi Surat Jalan (Fase 2 Fleet v2, 3 Agu 2026).
// SJH-15: Terima ≠ Berangkat.
// Terima → status 'diterima' saja (boleh kapan saja; tidak membuat trip, kendaraan tidak berubah).
// Berangkat → status 'jalan' + buat fleet_trip_log (jenis 'pengiriman'), HANYA bila SJ sudah dicetak,
//   disetujui, dan (bila kategori butuh) diloloskan satpam. Idempoten: trip tidak dibuat ganda.
// Tolak → status 'ditolak', alasan wajib diisi (rekomendasi dokumen: penolakan tercatat lebih berguna
// daripada driver diam lalu barang tidak jalan).
export const POST: RequestHandler = async (event) => {
	const { driver } = await authenticateDriver(event);
	const sjId = event.params.id;

	const body = await event.request.json().catch(() => null);
	const action = body?.action;
	const reason = body?.reason ? String(body.reason).trim() : '';
	const kmAwal = Number.isFinite(Number(body?.km_awal)) ? Number(body.km_awal) : null;

	if (action !== 'terima' && action !== 'tolak' && action !== 'berangkat') throw error(400, 'Aksi tidak valid.');
	if (action === 'tolak' && !reason) throw error(400, 'Alasan penolakan wajib diisi.');

	const sjQuery = new URLSearchParams({
		'filter[id][_eq]': String(sjId),
		'filter[delegated_driver_id][_eq]': driver.id,
		limit: '1'
	});
	const sjRes = await directusServerJson<{ data: any[] }>(`/items/surat_jalan?${sjQuery.toString()}`);
	const sj = sjRes?.data?.[0];
	if (!sj) throw error(404, 'Surat Jalan tidak ditemukan atau bukan delegasi Anda.');
	// Berangkat idempoten: sudah jalan + trip ada -> kembalikan trip yang sama.
	if (action === 'berangkat' && sj.delegation_status === 'jalan' && sj.fleet_trip_id) {
		return json({ record: sj, trip: { id: sj.fleet_trip_id }, already_started: true });
	}
	const allowed = action === 'berangkat' ? ['pending', 'diterima'] : ['pending'];
	if (!allowed.includes(sj.delegation_status)) {
		throw error(409, 'Delegasi ini sudah direspons sebelumnya.');
	}

	if (action === 'tolak') {
		const updated = await directusServerJson<{ data: any }>(`/items/surat_jalan/${sjId}`, {
			method: 'PATCH',
			body: JSON.stringify({ delegation_status: 'ditolak', delegation_notes: reason })
		});
		return json({ record: updated?.data ?? updated, trip: null });
	}

	if (action === 'terima') {
		// SJH-15: hanya menandai diterima — trip & kendaraan baru berubah saat Berangkat.
		const updated = await directusServerJson<{ data: any }>(`/items/surat_jalan/${sjId}`, {
			method: 'PATCH',
			body: JSON.stringify({ delegation_status: 'diterima' })
		});
		return json({ record: updated?.data ?? updated, trip: null });
	}

	// Berangkat — syarat server (cetak, approval, satpam, kendaraan).
	const blockers = evaluateBerangkat(sj, await sjButuhSatpam(sj.category));
	if (blockers.length) {
		throw error(409, `Belum bisa berangkat: ${blockers.join(' ')}`);
	}

	let effectiveKmAwal = kmAwal;
	if (effectiveKmAwal == null) {
		const kendaraanRes = await directusServerJson<{ data: any[] }>(
			`/items/fleet_kendaraan?filter[id][_eq]=${sj.vehicle_id}&fields=id,km_terakhir&limit=1`
		);
		effectiveKmAwal = Number(kendaraanRes?.data?.[0]?.km_terakhir) || 0;
	}

	const now = new Date().toISOString();
	// ESS Redesign Fase 1: SJ yang didelegasikan sudah punya fleet_bookings (Auto-Reserve).
	// Tautkan trip ke booking itu supaya lifecycle & ledger armada konsisten.
	const bookingId = sj.fleet_booking_id ? String(sj.fleet_booking_id) : null;
	const trip = await directusServerJson<{ data: any }>('/items/fleet_trip_log', {
		method: 'POST',
		body: JSON.stringify({
			vehicle_id: sj.vehicle_id,
			driver_id: driver.id,
			driver_name: driver.nama,
			booking_id: bookingId,
			jenis: 'pengiriman',
			tujuan: sj.delivery_address || sj.nomor_sj || 'Pengiriman Surat Jalan',
			keperluan: `Surat Jalan ${sj.nomor_sj || `#${sjId}`}`,
			tanggal_berangkat: now,
			waktu_mulai: now,
			km_awal: effectiveKmAwal,
			status: 'active'
		})
	});
	const tripId = trip?.data?.id;

	await directusServerJson(`/items/fleet_kendaraan/${sj.vehicle_id}`, {
		method: 'PATCH',
		body: JSON.stringify({ status: 'Dipinjam' })
	});

	// Booking Auto-Reserve → aktif (fail-soft; SJ lama tanpa fleet_booking_id dilewati).
	if (bookingId) {
		await directusServerJson(`/items/fleet_bookings/${bookingId}`, {
			method: 'PATCH',
			body: JSON.stringify({ status: 'aktif', trip_log_id: tripId, km_awal: effectiveKmAwal })
		}).catch(() => {});
	}

	const updated = await directusServerJson<{ data: any }>(`/items/surat_jalan/${sjId}`, {
		method: 'PATCH',
		body: JSON.stringify({ delegation_status: 'jalan', fleet_trip_id: tripId })
	});

	// Samakan dgn tombol Berangkat di Lacak SJ: catat tahap dalam_perjalanan (fail-soft).
	await recordKioskTrackingEvent({
		sjId: Number(sjId), stageTo: 'dalam_perjalanan',
		actor: { nama: driver.nama, role: 'driver' },
		notes: 'Berangkat (Delegasi)', clientEventId: `deleg-berangkat-${sjId}`, source: 'lapangan'
	}).catch((e) => console.error('[driver/delegation/respond] event dalam_perjalanan gagal (trip sudah dibuat):', e instanceof Error ? e.message : e));

	return json({ record: updated?.data ?? updated, trip: trip?.data ?? trip });
};
