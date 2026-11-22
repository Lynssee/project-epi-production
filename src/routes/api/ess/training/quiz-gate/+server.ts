// src/routes/api/ess/training/quiz-gate/+server.ts
// App-Blocking Gate kuis periodik (G_TRN_QUIZ_PERIODIC_WAJIB). GET = status gate milik sendiri (dipanggil sekali per sesi
// aplikasi + setelah submit kuis); POST = tunda darurat (hanya mode soft, alasan wajib, tercatat di gate_audit_log).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getQuizGateStatus, snoozeQuizGate } from '$lib/server/ess/quizGate';

export const GET: RequestHandler = async (event) => {
	const { user, karyawan } = await authenticateEss(event);
	const status = await getQuizGateStatus(karyawan, user.email ?? null);
	return json(status);
};

export const POST: RequestHandler = async (event) => {
	const { user, karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => null);
	try {
		const result = await snoozeQuizGate(karyawan, user.email ?? null, String(body?.alasan ?? ''));
		return json(result);
	} catch (e: any) {
		if (e?.status) throw error(e.status, e.message);
		throw e;
	}
};
