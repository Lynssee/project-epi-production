import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import {
	listPeerAssignments,
	listMyPeerReviews,
	submitPeerReview,
	isAssignedPeerReviewer,
	PEER_REVIEW_KRITERIA
} from '$lib/server/ess/kpiPeerReview';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const [assignments, myReviews] = await Promise.all([
		listPeerAssignments(karyawan.id),
		listMyPeerReviews(karyawan.id)
	]);
	return json({ assignments, myReviews, defaultKriteria: PEER_REVIEW_KRITERIA });
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json();
	const { scorecardId, kriteria, komentar } = body || {};

	if (!scorecardId || !Array.isArray(kriteria) || kriteria.length === 0) {
		throw error(400, 'scorecardId dan kriteria wajib diisi');
	}

	const eligible = await isAssignedPeerReviewer(karyawan.id, scorecardId);
	if (!eligible) {
		throw error(403, 'Anda tidak ditunjuk sebagai rekan penilai untuk scorecard ini');
	}

	const review = await submitPeerReview(scorecardId, karyawan.id, kriteria, komentar || '');
	return json({ review });
};
