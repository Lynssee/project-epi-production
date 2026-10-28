import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { acknowledgeSanksi } from '$lib/server/ess/disiplinSanksi';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const sanksiId = Number(event.params.id);
	if (!sanksiId) throw error(400, 'id tidak valid');

	try {
		const sanksi = await acknowledgeSanksi(sanksiId, karyawan.id);
		return json({ success: true, sanksi });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal konfirmasi tanda terima');
	}
};
