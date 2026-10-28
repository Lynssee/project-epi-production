// src/routes/api/preventive/p2h/tutup/+server.ts
// Pertajaman P2H (26 Agu 2026): menutup sesi P2H harian yang sudah ada di akhir
// pemakaian unit — TIDAK membuat sesi baru, hanya PATCH jam_selesai_pakai +
// signature_selesai + catatan_selesai ke p2h_session yang sudah diisi operator
// saat mulai pakai (submit awal, endpoint p2h/submit tidak diubah).
// Sengaja tidak menyentuh idempotensi/antrian offline submit awal yang sudah teruji.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticatePreventiveOperator } from '$lib/server/preventive/preventiveGuard';
import { directusServerJson } from '$lib/server/directus';

export const POST: RequestHandler = async (event) => {
	const { personnel } = await authenticatePreventiveOperator(event);

	const body = await event.request.json().catch(() => null);
	const sessionId = body?.session_id ? String(body.session_id) : '';
	const signature = body?.signature ? String(body.signature).trim() : '';
	const catatanSelesai = body?.catatan_selesai ? String(body.catatan_selesai).trim() : null;

	if (!sessionId) throw error(400, 'session_id wajib diisi.');
	if (!signature) throw error(400, 'Tanda tangan penutupan wajib diisi.');

	const sessionRes = await directusServerJson<{ data: any }>(
		`/items/p2h_session/${sessionId}?fields=id,operator_id,jam_selesai_pakai`
	).catch(() => null);
	const session = sessionRes?.data;
	if (!session) throw error(404, 'Sesi P2H tidak ditemukan.');
	if (session.jam_selesai_pakai) throw error(409, 'Sesi ini sudah ditutup sebelumnya.');

	const patched = await directusServerJson<{ data: any }>(`/items/p2h_session/${sessionId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			jam_selesai_pakai: new Date().toISOString(),
			signature_selesai: signature,
			catatan_selesai: catatanSelesai
		})
	});

	return json({ session: patched.data });
};
