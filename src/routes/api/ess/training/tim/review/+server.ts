import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listReviewable, submitTeamReview, OutcomeError } from '$lib/server/ess/trainingOutcome';

// Atasan/mentor mereview hasil training bawahan. Otorisasi tim dihitung server (bukan dari id klien).
export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const memberId = Number(event.url.searchParams.get('memberId'));
	if (!Number.isInteger(memberId) || memberId <= 0) throw error(400, 'memberId tidak valid');
	try {
		return json(await listReviewable(karyawan as any, memberId));
	} catch (e) {
		if (e instanceof OutcomeError) throw error(e.status, e.message);
		console.error('[ess/training/tim/review GET] gagal:', (e as Error)?.message);
		throw error(502, 'Gagal memuat data review.');
	}
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => ({}));
	const memberId = Number(body?.memberId), enrollmentId = Number(body?.enrollmentId);
	if (!Number.isInteger(memberId) || memberId <= 0 || !Number.isInteger(enrollmentId) || enrollmentId <= 0) throw error(400, 'memberId/enrollmentId tidak valid');
	try {
		const r = await submitTeamReview(karyawan as any, { ...body, memberId, enrollmentId });
		return json({ ok: true, ...r });
	} catch (e) {
		if (e instanceof OutcomeError) throw error(e.status, e.message);
		console.error('[ess/training/tim/review POST] gagal:', (e as Error)?.message);
		throw error(500, 'Gagal menyimpan review.');
	}
};
