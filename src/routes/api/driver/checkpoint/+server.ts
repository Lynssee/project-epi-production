import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateDriver } from '$lib/server/driver/driverGuard';
import { directusServerJson } from '$lib/server/directus';

/**
 * Checkpoint GPS manual — dipanggil saat driver menekan "Ambil Lokasi Saya" atau otomatis
 * saat mulai trip. Driver hanya boleh menulis checkpoint untuk trip/shipment miliknya sendiri.
 */
export const POST: RequestHandler = async (event) => {
	const { driver } = await authenticateDriver(event);

	const body = await event.request.json().catch(() => null);
	const tripLogId = body?.trip_log_id ? String(body.trip_log_id) : null;
	const shipmentId = body?.shipment_id ? String(body.shipment_id) : null;
	const label = body?.label ? String(body.label).trim() : 'Checkpoint';
	const latitude = Number(body?.latitude);
	const longitude = Number(body?.longitude);
	const alamat = body?.alamat ? String(body.alamat).trim() : '';
	const odometer = body?.odometer != null ? Number(body.odometer) : null;

	if (!tripLogId && !shipmentId) throw error(400, 'trip_log_id atau shipment_id wajib diisi.');
	if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw error(400, 'Koordinat lokasi tidak valid.');

	let vehicleId: string | null = null;

	if (tripLogId) {
		const tripQuery = new URLSearchParams({
			'filter[id][_eq]': tripLogId,
			'filter[driver_id][_eq]': driver.id,
			limit: '1'
		});
		const tripRes = await directusServerJson<{ data: any[] }>(`/items/fleet_trip_log?${tripQuery.toString()}`);
		const trip = tripRes?.data?.[0];
		if (!trip) throw error(404, 'Trip tidak ditemukan atau bukan milik Anda.');
		vehicleId = trip.vehicle_id;
	}

	const payload = {
		trip_log_id: tripLogId,
		shipment_id: shipmentId,
		vehicle_id: vehicleId,
		label,
		latitude,
		longitude,
		alamat,
		waktu: new Date().toISOString(),
		odometer,
		dicatat_oleh: driver.nama
	};

	const result = await directusServerJson<{ data: any }>('/items/fleet_gps_log', {
		method: 'POST',
		body: JSON.stringify(payload)
	});

	return json({ record: result?.data ?? result });
};
