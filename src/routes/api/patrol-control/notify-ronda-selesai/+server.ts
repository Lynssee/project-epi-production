import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { notifyRondaSelesai } from '$lib/server/patrolNotify';

/** Fase 4.2 — dipanggil klien (fire-and-forget) setelah finishPatrolLog berhasil. Server yang
 *  menilai ulang skor/anomali dari Directus (klien hanya kirim ID, tidak dipercaya). */
export const POST: RequestHandler = async (event) => {
	await authenticateEss(event);
	const body = await event.request.json().catch(() => null);
	const patrolLogId = Number(body?.patrol_log_id);
	if (!patrolLogId) throw error(400, 'patrol_log_id wajib diisi.');

	// Best-effort — jangan lempar error ke klien walau gagal, ronda sudah selesai duluan.
	notifyRondaSelesai(patrolLogId).catch(() => {});

	return json({ queued: true });
};
