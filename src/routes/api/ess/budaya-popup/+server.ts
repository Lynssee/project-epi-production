import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getPopupPayload, submitPopupAck, PopupError } from '$lib/server/ess/budayaPopup';

// GET  = payload popup hari ini (audiens lapangan) — SATU request per hari untuk semua momen; klien memilih momen lokal.
// POST = { propaganda_id, momen? } → catat tombol "Paham" pada popup tanpa kuis. Gagal baca = payload kosong (tak ada popup).
export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	try {
		return json(await getPopupPayload(karyawan as any));
	} catch (e) {
		console.error('[api/ess/budaya-popup] GET gagal:', e);
		return json({ enabled: false, ymd: null, settings: {}, items: [] });
	}
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => null);
	if (!body || body.propaganda_id == null) throw error(400, 'propaganda_id wajib diisi.');
	try {
		return json(await submitPopupAck(karyawan as any, { propagandaId: body.propaganda_id, momen: body.momen }));
	} catch (e) {
		if (e instanceof PopupError) throw error(e.status, e.message);
		console.error('[api/ess/budaya-popup] POST gagal:', e);
		throw error(500, 'Gagal mencatat konfirmasi popup.');
	}
};
