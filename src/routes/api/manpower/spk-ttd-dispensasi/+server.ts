// src/routes/api/manpower/spk-ttd-dispensasi/+server.ts
// Lapangan: aktifkan SPK TANPA tanda tangan manpower dengan alasan tertulis (jalan keluar bila mandor tak bisa TTD).
// POST { assignment_id, alasan } -> { success }. Tercatat: ttd_via='dispensasi', ttd_dispensasi_alasan, pelaku pada ttd_nama.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { otorisasiPenugasan, dispensasi, balasGalat, SpkTtdError } from '$lib/server/spkTtdLapangan';

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	const assignmentId = Number(body?.assignment_id);
	if (!assignmentId) return balasGalat(new SpkTtdError(400, 'assignment_id wajib diisi.'));
	try {
		const { a, oleh } = await otorisasiPenugasan(event, assignmentId);
		return json(await dispensasi(a, body?.alasan, oleh));
	} catch (e) {
		return balasGalat(e);
	}
};
