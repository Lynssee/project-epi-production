// GET /api/proyek/[project_id]/sengketa-hukum -> { aktif, tahap } (tanpa nominal/nomor PA).
import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getProjectLegalDispute } from '$lib/server/legalDisputeStatus';

export const GET: RequestHandler = async (event) => {
	await requireUser(event);
	return json(await getProjectLegalDispute(event.params.project_id as string));
};
