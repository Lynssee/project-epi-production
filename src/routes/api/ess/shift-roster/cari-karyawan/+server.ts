// src/routes/api/ess/shift-roster/cari-karyawan/+server.ts
// ESS HRD v3 Fase 3 Modul 4 — cari rekan kerja utk tukar shift. ?q=nama

import { json, type RequestEvent } from '@sveltejs/kit';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

export async function GET(event: RequestEvent) {
	const { karyawan } = await authenticateEss(event);
	const q = (event.url.searchParams.get('q') || '').trim();
	if (q.length < 2) return json({ data: [] });

	const filter = encodeURIComponent(
		JSON.stringify({ nama_karyawan: { _icontains: q }, id: { _neq: karyawan.id } })
	);
	const result = await directusServerJson(`/items/karyawan?filter=${filter}&fields=id,nama_karyawan&limit=10`);
	return json({ data: result?.data || [] });
}
