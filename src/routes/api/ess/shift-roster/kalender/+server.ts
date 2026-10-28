// src/routes/api/ess/shift-roster/kalender/+server.ts
// ESS HRD v3 Fase 3 Modul 4 — kalender shift_roster karyawan login sendiri. Query param
// ?bulan=YYYY-MM (default bulan berjalan).

import { json, type RequestEvent } from '@sveltejs/kit';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

export async function GET(event: RequestEvent) {
	const { karyawan } = await authenticateEss(event);

	const bulan = event.url.searchParams.get('bulan') || new Date().toISOString().slice(0, 7);
	const start = `${bulan}-01`;
	const endDate = new Date(start + 'T00:00:00');
	endDate.setMonth(endDate.getMonth() + 1);
	endDate.setDate(0);
	const end = endDate.toISOString().slice(0, 10);

	const filter = encodeURIComponent(
		JSON.stringify({ karyawan_id: { _eq: karyawan.id }, tanggal: { _between: [start, end] } })
	);
	const result = await directusServerJson(
		`/items/shift_roster?filter=${filter}&fields=id,tanggal,status,swap_with,jadwal_kerja_id.id,jadwal_kerja_id.nama_jadwal&sort=tanggal&limit=-1`
	);
	return json({ data: result?.data || [] });
}
