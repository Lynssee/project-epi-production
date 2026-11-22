import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getBudayaHarian, submitBudayaAck, BudayaAckError } from '$lib/server/ess/budayaHarian';

// GET  = konten budaya hari ini (audiens lapangan) + status "siap laksanakan" karyawan login.
// POST = catat komitmen / jawaban kuis { propaganda_id, aksi: 'komitmen'|'kuis', jawaban_idx? } — dinilai di server.
export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	return json(await getBudayaHarian(karyawan as any));
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => null);
	if (!body || body.propaganda_id == null) throw error(400, 'propaganda_id wajib diisi.');
	try {
		return json(
			await submitBudayaAck(karyawan as any, {
				propagandaId: body.propaganda_id,
				aksi: String(body.aksi ?? ''),
				jawabanIdx: body.jawaban_idx
			})
		);
	} catch (e) {
		if (e instanceof BudayaAckError) throw error(e.status, e.message);
		console.error('[api/ess/budaya-harian] POST gagal:', e);
		throw error(500, 'Gagal mencatat komitmen budaya.');
	}
};
