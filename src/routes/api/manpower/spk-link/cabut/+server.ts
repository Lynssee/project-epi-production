// src/routes/api/manpower/spk-link/cabut/+server.ts
// Lapangan: cabut semua tautan TTD aktif sebuah penugasan. POST { assignment_id } -> { success, dicabut }
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { otorisasiPenugasan, cabutSemua, balasGalat, SpkTtdError } from '$lib/server/spkTtdLapangan';

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	const assignmentId = Number(body?.assignment_id);
	if (!assignmentId) return balasGalat(new SpkTtdError(400, 'assignment_id wajib diisi.'));
	try {
		await otorisasiPenugasan(event, assignmentId);
		return json({ success: true, ...(await cabutSemua(assignmentId)) });
	} catch (e) {
		return balasGalat(e);
	}
};
