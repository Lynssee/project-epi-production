import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { submitBanding } from '$lib/server/ess/disiplinSanksi';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const sanksiId = Number(event.params.id);
	if (!sanksiId) throw error(400, 'id tidak valid');

	const body = await event.request.json().catch(() => ({}));
	const alasan = body?.alasan;

	try {
		const sanksi = await submitBanding(sanksiId, karyawan.id, String(alasan || ''));
		return json({ success: true, sanksi });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal mengajukan banding');
	}
};
