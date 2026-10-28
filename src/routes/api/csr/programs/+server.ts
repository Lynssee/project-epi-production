import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

/** Program CSR yang sedang berjalan (status disetujui/berjalan) — untuk picker di form lapangan. */
export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);

	const res = await directusServerJson<{ data: any[] }>(
		`/items/csr_program?${new URLSearchParams({
			'filter[status][_in]': 'disetujui,berjalan',
			fields: 'id,nama,pilar,lokasi,sasaran',
			sort: 'nama',
			limit: '-1'
		}).toString()}`
	);

	return json({ programs: res?.data || [] });
};
