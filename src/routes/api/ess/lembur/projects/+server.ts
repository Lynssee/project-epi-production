import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

/** P6: daftar proyek aktif untuk picker di form pengajuan lembur — supaya `proyek_id`
 * mulai terisi (prasyarat alokasi biaya lembur per proyek, follow-up terpisah). */
export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);

	// Hanya proyek yang masih berjalan. Status "selesai" (mayoritas data, ratusan baris) &
	// "closed" dibuang supaya picker di form tidak kebanjiran proyek lama + payload ringan.
	const query = new URLSearchParams({
		'filter[status][_nin]': 'closed,selesai,cancel,cancelled,batal',
		fields: 'id,name,nomor_po',
		sort: 'name',
		limit: '300'
	});
	const result = await directusServerJson<{ data: Array<{ id: number; name: string | null; nomor_po: string | null }> }>(
		`/items/projects?${query.toString()}`
	);
	return json({ projects: result?.data || [] });
};
