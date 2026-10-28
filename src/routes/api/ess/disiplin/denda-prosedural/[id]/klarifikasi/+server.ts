import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { ajukanKlarifikasi } from '$lib/server/ess/dendaProsedural';

// POST /api/ess/disiplin/denda-prosedural/:id/klarifikasi  { alasan }
// Karyawan mengajukan klarifikasi atas satu kejadian denda prosedural. Tidak membebaskan —
// hanya mencatat permintaan; HRD memutuskan di /hrd?tab=disiplin-denda. Fase 3.
export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const logId = Number(event.params.id);
	if (!logId) throw error(400, 'id tidak valid');

	const body = await event.request.json().catch(() => ({}));
	try {
		const log = await ajukanKlarifikasi(logId, karyawan.id, String(body?.alasan || ''));
		return json({ success: true, log });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal mengajukan klarifikasi');
	}
};
