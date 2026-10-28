// src/routes/api/fleet/my-vehicles/+server.ts
// Fase 4 v2 "Perketat Gate BBM & E-Toll" (9 Sep 2026) — daftar kendaraan yang boleh
// dipilih user di form Biaya Lapangan. Keputusan user (8 Sep 2026): DIBATASI ke
// kendaraan yang di-booking/ditugaskan saja (bukan semua kendaraan aktif + opsi
// pribadi) — supaya G_P2H_UNIT_LAPANGAN bisa ditegakkan konsisten (kendaraan yang
// tidak melalui booking/assignment resmi tidak akan pernah lolos P2H tercatat).
//
// Dua sumber (Directus fetch dipisah per relasi, Aturan #1/#2):
// 1. fleet_driver_assignment aktif=true untuk driver yang terhubung ke karyawan ini.
// 2. fleet_bookings berstatus disetujui/aktif atas nama karyawan ini (karyawan_id —
//    field legacy, satu-satunya penanda peminjam yang tersedia untuk non-driver saat
//    ini; booking baru yang tidak mengisi field ini tidak akan muncul di sini).

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const vehicleIds = new Set<string>();

	const driverRes = await directusServerJson<{ data: Array<{ id: string }> }>(
		`/items/fleet_drivers?filter[karyawan_id][_eq]=${karyawan.id}&fields=id&limit=1`
	).catch(() => null);
	const driverId = driverRes?.data?.[0]?.id;

	if (driverId) {
		const assignRes = await directusServerJson<{ data: Array<{ vehicle_id: string }> }>(
			`/items/fleet_driver_assignment?filter[driver_id][_eq]=${driverId}&filter[aktif][_eq]=true&fields=vehicle_id&limit=-1`
		).catch(() => null);
		for (const row of assignRes?.data || []) if (row.vehicle_id) vehicleIds.add(String(row.vehicle_id));
	}

	const bookingRes = await directusServerJson<{ data: Array<{ vehicle_id: string }> }>(
		`/items/fleet_bookings?filter[karyawan_id][_eq]=${karyawan.id}&filter[status][_in]=disetujui,aktif&fields=vehicle_id&limit=-1`
	).catch(() => null);
	for (const row of bookingRes?.data || []) if (row.vehicle_id) vehicleIds.add(String(row.vehicle_id));

	if (vehicleIds.size === 0) {
		return json({ vehicles: [] });
	}

	const idsParam = Array.from(vehicleIds).join(',');
	const kendaraanRes = await directusServerJson<{ data: Array<{ id: number; nomor_polisi: string; merk: string; model: string }> }>(
		`/items/fleet_kendaraan?filter[id][_in]=${idsParam}&fields=id,nomor_polisi,merk,model&limit=-1`
	).catch(() => null);

	const vehicles = (kendaraanRes?.data || []).map((v) => ({
		id: v.id,
		label: [v.nomor_polisi, v.merk, v.model].filter(Boolean).join(' — ')
	}));

	return json({ vehicles });
};
