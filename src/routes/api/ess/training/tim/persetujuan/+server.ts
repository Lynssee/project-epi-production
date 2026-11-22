import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { approveRetry, SignoffError } from '$lib/server/ess/mentorSignoff';

// Atasan/mentor menyetujui SATU percobaan ulang kuis bagi bawahannya setelah membina (gate G_TRN_MENTOR_SIGNOFF). Otorisasi tim dicek server.
export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => ({}));
	const enrollmentId = Number(body?.enrollmentId);
	const quizId = Number(body?.quizId);
	if (!Number.isInteger(enrollmentId) || enrollmentId <= 0 || !Number.isInteger(quizId) || quizId <= 0) throw error(400, 'enrollmentId/quizId tidak valid');
	try {
		return json({ ok: true, ...(await approveRetry(karyawan as any, { enrollmentId, quizId, catatan: String(body?.catatan ?? '') })) });
	} catch (e) {
		if (e instanceof SignoffError) throw error(e.status, e.message);
		console.error('[ess/training/tim/persetujuan] gagal:', (e as Error)?.message);
		throw error(500, 'Gagal menyimpan persetujuan.');
	}
};
