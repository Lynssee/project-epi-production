import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateDriver } from '$lib/server/driver/driverGuard';
import { directusServerJson } from '$lib/server/directus';
import { applyCashAdvanceSettlement } from '$lib/server/fleetSettlement';

export const POST: RequestHandler = async (event) => {
	const { driver } = await authenticateDriver(event);
	const tripId = event.params.id;

	const body = await event.request.json().catch(() => null);
	const kmAkhir = Number(body?.km_akhir);
	const fotoOdometerAkhir = body?.foto_odometer_akhir ? String(body.foto_odometer_akhir) : null;
	const catatanDriver = body?.catatan_driver ? String(body.catatan_driver).trim() : '';

	if (!Number.isFinite(kmAkhir) || kmAkhir < 0) throw error(400, 'KM akhir tidak valid.');

	const tripQuery = new URLSearchParams({
		'filter[id][_eq]': tripId,
		'filter[driver_id][_eq]': driver.id,
		limit: '1'
	});
	const tripRes = await directusServerJson<{ data: any[] }>(`/items/fleet_trip_log?${tripQuery.toString()}`);
	const trip = tripRes?.data?.[0];
	if (!trip) throw error(404, 'Trip tidak ditemukan atau bukan milik Anda.');
	if (trip.status !== 'active') throw error(409, 'Trip ini sudah selesai.');
	if (kmAkhir < Number(trip.km_awal ?? 0)) throw error(400, 'KM akhir tidak boleh kurang dari KM awal.');

	const now = new Date().toISOString();
	const patch: Record<string, unknown> = {
		km_akhir: kmAkhir,
		waktu_selesai: now,
		tanggal_kembali: now,
		foto_odometer_akhir: fotoOdometerAkhir,
		status: 'completed'
	};
	if (catatanDriver) {
		patch.catatan_driver = trip.catatan_driver ? `${trip.catatan_driver}\n${catatanDriver}` : catatanDriver;
	}

	const result = await directusServerJson<{ data: any }>(`/items/fleet_trip_log/${tripId}`, {
		method: 'PATCH',
		body: JSON.stringify(patch)
	});

	// Kendaraan kembali tersedia — sama persis dengan updateVehicleStatus() di erp-epi-1.
	// vehicle_id merujuk fleet_kendaraan (master tunggal sejak Fase 0 Fleet v2), bukan equipment lagi.
	await directusServerJson(`/items/fleet_kendaraan/${trip.vehicle_id}`, {
		method: 'PATCH',
		body: JSON.stringify({ status: 'Tersedia' })
	});

	// ESS Redesign Fase 1: trip pengiriman (delegasi SJ) terikat booking Auto-Reserve — tutup booking-nya
	// supaya cek-bentrok & rekonsiliasi tidak menganggap unit masih terpakai. Fail-soft.
	// Dibatasi jenis 'pengiriman' agar tidak bentrok dengan alur return checklist peminjam biasa.
	if (trip.booking_id && trip.jenis === 'pengiriman') {
		await directusServerJson(`/items/fleet_bookings/${trip.booking_id}`, {
			method: 'PATCH',
			body: JSON.stringify({ status: 'selesai', km_akhir: kmAkhir, tanggal_selesai_aktual: now })
		}).catch(() => {});
	}

	// ESS Redesign Fase 3: settlement uang muka (idempoten, no-op bila tak ada uang muka dicairkan).
	if (trip.booking_id) {
		try {
			const bRes = await directusServerJson<{ data: any }>(`/items/fleet_bookings/${trip.booking_id}`).catch(() => null);
			if (bRes?.data) await applyCashAdvanceSettlement(bRes.data);
		} catch (e) {
			console.warn('[trip/finish] settlement uang muka gagal (diabaikan):', (e as any)?.message || e);
		}
	}

	const jarakKm = kmAkhir - Number(trip.km_awal ?? 0);
	return json({ record: result?.data ?? result, jarak_km: jarakKm });
};
