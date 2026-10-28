import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import {
	listKpiKaryawan,
	listPendingKpi,
	listLiveKpiKaryawan,
	listSelfReviews,
	submitSelfReview,
	listKpiNotifications,
	listKpiTrend,
	SELF_ASSESSMENT_KRITERIA
} from '$lib/server/ess/kpi';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const [kpiList, pendingList, liveKpiList, notifications, trend] = await Promise.all([
		listKpiKaryawan(karyawan.id),
		listPendingKpi(karyawan.id),
		listLiveKpiKaryawan(karyawan.id),
		listKpiNotifications(karyawan.id).catch(() => []),
		listKpiTrend(karyawan.id, 6).catch(() => [])
	]);
	const selfReviews = await listSelfReviews(pendingList.map((k) => k.id));
	return json({ kpiList, pendingList, liveKpiList, selfReviews, defaultKriteria: SELF_ASSESSMENT_KRITERIA, notifications, trend });
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json();
	const { scorecardId, kriteria, komentar } = body || {};

	if (!scorecardId || !Array.isArray(kriteria) || kriteria.length === 0) {
		throw error(400, 'scorecardId dan kriteria wajib diisi');
	}

	// Pastikan scorecard ini memang milik karyawan yang login (bukan orang lain).
	const pendingList = await listPendingKpi(karyawan.id);
	if (!pendingList.some((k) => k.id === scorecardId)) {
		throw error(403, 'Kartu skor ini tidak ditemukan atau bukan milik Anda');
	}

	const review = await submitSelfReview(scorecardId, karyawan.id, kriteria, komentar || '');
	return json({ review });
};
