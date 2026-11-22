import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { submitMicroquizAnswer, PopupError } from '$lib/server/ess/budayaPopup';

// POST { propaganda_id, jawaban_idx, momen? } → nilai 1 jawaban microquiz di SERVER. Kunci jawaban hanya dikembalikan setelah
// benar / coba ulang habis; percobaan dihitung server. 1 request hanya saat karyawan menjawab.
export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => null);
	if (!body || body.propaganda_id == null || body.jawaban_idx == null) throw error(400, 'propaganda_id dan jawaban_idx wajib diisi.');
	try {
		return json(await submitMicroquizAnswer(karyawan as any, { propagandaId: body.propaganda_id, jawabanIdx: body.jawaban_idx, momen: body.momen, token: body.token }));
	} catch (e) {
		if (e instanceof PopupError) throw error(e.status, e.message);
		console.error('[api/ess/budaya-microquiz] POST gagal:', e);
		throw error(500, 'Gagal menilai jawaban microquiz.');
	}
};
