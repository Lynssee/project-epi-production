// src/routes/api/driver/start-daily-task/+server.ts
// Tombol "Mulai Tugas Hari Ini" (Fase 2, §9.2.1, K3) — driver operasional harian tetap
// lewat alur fleet_bookings tanpa mengisi form dari nol tiap pagi.
// Idempoten: dipanggil berkali-kali dalam sehari akan mengembalikan booking yang sama.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateDriver } from '$lib/server/driver/driverGuard';
import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { genKodeBooking, isKodeCollision } from '$lib/server/fleetKode';

export const POST: RequestHandler = async (event) => {
	const { karyawan, driver } = await authenticateDriver(event);
	const body = await event.request.json().catch(() => ({}));
	const vehicleIdOverride = body?.vehicle_id ? Number(body.vehicle_id) : null;

	const today = todayJakarta();
	const todayStart = `${today}T00:00:00`;
	const todayEnd = `${today}T23:59:59`;

	// 1. Cek booking operasional_harian hari ini milik driver ini — idempoten
	const existingFilter = encodeURIComponent(
		JSON.stringify({
			_and: [
				{ karyawan_id: { _eq: String(karyawan.id) } },
				{ tipe_keperluan: { _eq: 'operasional_harian' } },
				{ tanggal_mulai: { _gte: todayStart, _lte: todayEnd } },
				{ status: { _in: ['diajukan', 'disetujui', 'aktif'] } }
			]
		})
	);
	const existingRes = await directusServerJson<{ data: any[] }>(
		`/items/fleet_bookings?filter=${existingFilter}&limit=1`
	).catch(() => ({ data: [] }));
	if (existingRes?.data?.length) {
		return json({ booking: existingRes.data[0], created: false });
	}

	// 2. Cari kendaraan langganan driver (fleet_driver_assignment)
	let vehicleId = vehicleIdOverride;
	if (!vehicleId) {
		const assignFilter = encodeURIComponent(JSON.stringify({ driver_id: { _eq: driver.id }, aktif: { _eq: true } }));
		const assignRes = await directusServerJson<{ data: any[] }>(
			`/items/fleet_driver_assignment?filter=${assignFilter}&fields=vehicle_id&limit=1`
		).catch(() => ({ data: [] }));
		vehicleId = assignRes?.data?.[0]?.vehicle_id || null;
	}

	if (!vehicleId) {
		return json({ needsVehicleSelection: true, booking: null, created: false });
	}

	// 3. Ambil setting auto_approve_operasional_harian
	const settingsRes = await directusServerJson<{ data: any[] }>(
		`/items/fleet_settings?filter[key][_eq]=auto_approve_operasional_harian&limit=1`
	).catch(() => ({ data: [] }));
	const autoApprove = settingsRes?.data?.[0] ? !!settingsRes.data[0].value : true;

	// 4. Buat booking baru, tahap 1 dilewati sesuai K3
	const payload = {
		kode_booking: genKodeBooking(),
		vehicle_id: vehicleId,
		driver_id: driver.id,
		karyawan_id: String(karyawan.id),
		butuh_driver: false,
		requester_name: karyawan.nama_karyawan,
		requester_dept: karyawan.divisi || null,
		keperluan: 'Tugas operasional harian',
		tujuan: '-',
		tanggal_mulai: new Date().toISOString(),
		tipe_keperluan: 'operasional_harian',
		status: autoApprove ? 'disetujui' : 'diajukan',
		approver: autoApprove ? 'Sistem (auto-approve operasional harian)' : null,
		tanggal_approve: autoApprove ? new Date().toISOString() : null,
		catatan: 'Dibuat otomatis lewat tombol "Mulai Tugas Hari Ini".'
	};

	// Peminjaman 12 §2: tabrakan kode (kolom unique) → kode baru, maks 3x.
	let created!: { data: any };
	for (let attempt = 1; ; attempt++) {
		try {
			created = await directusServerJson<{ data: any }>('/items/fleet_bookings', { method: 'POST', body: JSON.stringify(payload) });
			break;
		} catch (e) {
			if (attempt < 3 && isKodeCollision(e)) {
				payload.kode_booking = genKodeBooking();
				continue;
			}
			throw e;
		}
	}

	return json({ booking: created?.data ?? created, created: true });
};
