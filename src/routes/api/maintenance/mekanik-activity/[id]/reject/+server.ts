import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateProjectLeaderForEquipment } from '$lib/server/projectLeaderGuard';
import { directusServerJson } from '$lib/server/directus';

export const POST: RequestHandler = async (event) => {
	const id = event.params.id;
	const body = await event.request.json().catch(() => ({}));
	const catatan = typeof body?.catatan === 'string' ? body.catatan.trim() : '';
	if (!catatan) throw error(400, 'Catatan penolakan wajib diisi supaya mekanik tahu apa yang perlu diperbaiki.');

	const activity = await directusServerJson<{ data: any }>(
		`/items/mekanik_activity/${id}?fields=id,equipment_id,approval_status`
	).then((r) => r?.data);
	if (!activity) throw error(404, 'Laporan tidak ditemukan.');
	if (activity.approval_status === 'approved') throw error(409, 'Laporan ini sudah disetujui, tidak bisa ditolak.');

	const { karyawan } = await authenticateProjectLeaderForEquipment(event, activity.equipment_id);

	const result = await directusServerJson(`/items/mekanik_activity/${id}`, {
		method: 'PATCH',
		body: JSON.stringify({
			approval_status: 'rejected',
			approved_by_id: karyawan.id,
			approved_at: new Date().toISOString(),
			catatan_leader: catatan
		})
	});

	return json({ record: result?.data ?? result });
};
