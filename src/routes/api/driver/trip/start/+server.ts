import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateDriver } from '$lib/server/driver/driverGuard';
import { directusServerJson } from '$lib/server/directus';

export const POST: RequestHandler = async (event) => {
	const { driver } = await authenticateDriver(event);

	const body = await event.request.json().catch(() => null);
	const vehicleId = body?.vehicle_id ? String(body.vehicle_id) : '';
	const kmAwal = Number(body?.km_awal);
	const fotoOdometerAwal = body?.foto_odometer_awal ? String(body.foto_odometer_awal) : null;
	const catatanDriver = body?.catatan_driver ? String(body.catatan_driver).trim() : '';
	const bookingId = body?.booking_id ? String(body.booking_id) : null;
	const tujuan = body?.tujuan ? String(body.tujuan).trim() : '';
	const keperluan = body?.keperluan ? String(body.keperluan).trim() : '';
	const jenisInput = body?.jenis ? String(body.jenis) : null;
	const JENIS_VALID = ['umum', 'peminjaman', 'logistik_harian'];

	if (!vehicleId) throw error(400, 'Kendaraan wajib dipilih.');
	if (!Number.isFinite(kmAwal) || kmAwal < 0) throw error(400, 'KM awal tidak valid.');
	if (jenisInput && !JENIS_VALID.includes(jenisInput)) throw error(400, 'Jenis trip tidak valid.');

	// Driver tidak boleh mulai trip baru selagi masih ada trip aktif miliknya.
	const activeQuery = new URLSearchParams({
		'filter[driver_id][_eq]': driver.id,
		'filter[status][_eq]': 'active',
		limit: '1'
	});
	const active = await directusServerJson<{ data: any[] }>(`/items/fleet_trip_log?${activeQuery.toString()}`);
	if (active?.data?.length) {
		throw error(409, 'Anda masih memiliki trip aktif yang belum diselesaikan.');
	}

	const now = new Date().toISOString();
	const payload = {
		vehicle_id: vehicleId,
		driver_id: driver.id,
		driver_name: driver.nama,
		booking_id: bookingId,
		jenis: jenisInput || (bookingId ? 'peminjaman' : 'umum'),
		tujuan,
		keperluan,
		tanggal_berangkat: now,
		waktu_mulai: now,
		km_awal: kmAwal,
		foto_odometer_awal: fotoOdometerAwal,
		catatan_driver: catatanDriver,
		status: 'active'
	};

	const result = await directusServerJson<{ data: any }>('/items/fleet_trip_log', {
		method: 'POST',
		body: JSON.stringify(payload)
	});

	// Tandai kendaraan sedang dipakai — sama persis dengan updateVehicleStatus()
	// di erp-epi-1/src/lib/services/fleetApi.js, supaya admin & driver app konsisten.
	// vehicle_id merujuk fleet_kendaraan (master tunggal sejak Fase 0 Fleet v2), bukan equipment lagi.
	await directusServerJson(`/items/fleet_kendaraan/${vehicleId}`, {
		method: 'PATCH',
		body: JSON.stringify({ status: 'Dipinjam' })
	});

	return json({ record: result?.data ?? result });
};
