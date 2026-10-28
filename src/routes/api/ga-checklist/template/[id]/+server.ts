import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

export const GET: RequestHandler = async (event) => {
	try {
		const { karyawan } = await authenticateEss(event);
		const id = event.params.id;

		const templateRes = await directusServerJson<{ data: any }>(`/items/ga_checklist_template/${id}`);
		if (!templateRes?.data) throw error(404, 'Template tidak ditemukan.');

		const itemsRes = await directusServerJson<{ data: any[] }>(
			`/items/ga_checklist_items?${new URLSearchParams({
				'filter[template_id][_eq]': String(id),
				sort: 'sort_order',
				limit: '-1'
			}).toString()}`
		);

		const items = (itemsRes?.data || []).filter((it) => {
			if (Array.isArray(it.delegated_staff_ids) && it.delegated_staff_ids.length > 0) {
				return it.delegated_staff_ids.map(String).includes(String(karyawan.id));
			}
			return true;
		});

		return json({ ...templateRes.data, items });
	} catch (err: any) {
		console.error('[api/ga-checklist/template/[id]] error:', err);
		const status = err?.status || 500;
		const message = err?.body?.message || err?.message || 'Gagal memuat template checklist';
		return json({ message }, { status });
	}
};
