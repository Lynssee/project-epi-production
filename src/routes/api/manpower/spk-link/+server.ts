// src/routes/api/manpower/spk-link/+server.ts
// Lapangan (login + pemegang proyek): buat / daftar tautan TTD SPK manpower. Halaman publik ada di erp-epi.
//   POST { assignment_id, mode?: 'link'|'kiosk_pl' } -> { success, id, url, kedaluwarsa, hari, mode }
//   GET  ?assignment_id= -> { success, aktif, links[] }
// Dikunci setelan manpower.spk_doc.ttd_link_aktif — lihat spkTtdLapangan.ts.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { otorisasiPenugasan, buatLink, daftarLink, balasGalat, SpkTtdError } from '$lib/server/spkTtdLapangan';

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	const assignmentId = Number(body?.assignment_id);
	if (!assignmentId) return balasGalat(new SpkTtdError(400, 'assignment_id wajib diisi.'));
	try {
		const { a, oleh } = await otorisasiPenugasan(event, assignmentId);
		return json({ success: true, ...(await buatLink(a, { mode: body?.mode === 'kiosk_pl' ? 'kiosk_pl' : 'link', oleh, varian: body?.varian === 'tanpa_harga' ? 'tanpa_harga' : 'lengkap', manpowerId: body?.manpower_id ? Number(body.manpower_id) : null })) });
	} catch (e) {
		return balasGalat(e);
	}
};

export const GET: RequestHandler = async (event) => {
	const assignmentId = Number(event.url.searchParams.get('assignment_id'));
	if (!assignmentId) return balasGalat(new SpkTtdError(400, 'assignment_id wajib diisi.'));
	try {
		await otorisasiPenugasan(event, assignmentId);
		return json({ success: true, ...(await daftarLink(assignmentId)) });
	} catch (e) {
		return balasGalat(e);
	}
};
