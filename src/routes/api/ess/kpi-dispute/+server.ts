import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listMyDisputes, canDisputeScorecard, submitDispute } from '$lib/server/ess/kpiDispute';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const disputes = await listMyDisputes(karyawan.id);
	return json({ disputes });
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json();
	const { scorecardId, alasan } = body || {};

	if (!scorecardId || !alasan || !String(alasan).trim()) {
		throw error(400, 'scorecardId dan alasan wajib diisi');
	}

	const eligible = await canDisputeScorecard(karyawan.id, scorecardId);
	if (!eligible) {
		throw error(403, 'Skor ini belum bisa diajukan keberatan — pastikan periode sudah dirilis dan scorecard ini milik Anda.');
	}

	const existing = await listMyDisputes(karyawan.id);
	if (existing.some((d) => d.scorecard_id === scorecardId && (d.status === 'diajukan' || d.status === 'ditinjau'))) {
		throw error(409, 'Anda sudah punya keberatan yang masih diproses untuk skor ini.');
	}

	const dispute = await submitDispute(karyawan.id, scorecardId, String(alasan).trim());
	return json({ dispute });
};
