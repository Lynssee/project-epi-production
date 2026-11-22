import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { catatPembinaan, PembinaanError } from '$lib/server/ess/teamTraining';

// Atasan mencatat pembinaan bawahan -> Action Plan (dipakai gate G_KPI_MENTOR_ACCOUNTABILITY di admin). Otorisasi tim diperiksa server.
export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => ({}));
	const memberId = Number(body?.memberId);
	if (!Number.isInteger(memberId) || memberId <= 0) throw error(400, 'memberId tidak valid');
	try {
		const r = await catatPembinaan(karyawan as any, { memberId, catatan: String(body?.catatan ?? ''), targetSelesai: body?.targetSelesai });
		return json({ ok: true, ...r });
	} catch (e) {
		if (e instanceof PembinaanError) throw error(e.status, e.message);
		console.error('[ess/training/tim/pembinaan] gagal:', (e as Error)?.message);
		throw error(500, 'Gagal menyimpan catatan pembinaan.');
	}
};
