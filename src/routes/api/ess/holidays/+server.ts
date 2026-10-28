import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

// L-01: daftar hari libur nasional dalam rentang tanggal, untuk estimator lembur di client
// (koleksi holidays sama dengan yang dipakai isNationalHolidayOn di holidays.ts — jangan duplikasi).
export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);

	const start = event.url.searchParams.get('start');
	const end = event.url.searchParams.get('end');
	if (!start || !end) return json({ dates: [] });

	const query = new URLSearchParams({
		'filter[date][_gte]': start,
		'filter[date][_lte]': end,
		'filter[is_active][_eq]': 'true',
		fields: 'date',
		limit: '-1'
	});
	try {
		const result = await directusServerJson<{ data: Array<{ date: string }> }>(
			`/items/holidays?${query.toString()}`
		);
		return json({ dates: (result?.data || []).map((d) => d.date) });
	} catch (e) {
		console.warn('[api/ess/holidays] Gagal ambil kalender libur:', e);
		return json({ dates: [] });
	}
};
