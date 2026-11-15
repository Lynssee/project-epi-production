// POST /api/visit-leader/tutup — PDP-33: leader menutup satu visit (kegiatan wajib + foto minimal sesuai setelan).
// Body: { visitId, kegiatan, temuan?, tindakLanjut?, rencanaBesok?, fotoIds: string[] }
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tutupVisit } from '$lib/server/visitLeaderTutup';

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => null);
	const visitId = Number(body?.visitId);
	if (!Number.isInteger(visitId) || visitId <= 0) throw error(400, 'visitId wajib diisi.');
	const r = await tutupVisit(event, {
		visitId,
		kegiatan: String(body?.kegiatan ?? ''),
		temuan: body?.temuan,
		tindakLanjut: body?.tindakLanjut,
		rencanaBesok: body?.rencanaBesok,
		fotoIds: Array.isArray(body?.fotoIds) ? body.fotoIds : []
	});
	return json({ success: true, ...r });
};
