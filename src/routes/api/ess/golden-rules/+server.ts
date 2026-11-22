import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getGoldenRulesStatus, submitGoldenPledge, GoldenRulesError } from '$lib/server/ess/goldenRules';

// GET ?project_id=  = status Golden Rules untuk karyawan login pada proyek itu ({ enabled, wajib, rules, sudahIkrar }).
// POST { project_id } = catat ikrar (1x per karyawan per proyek, idempoten). Identitas dari login.
export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	return json(await getGoldenRulesStatus(karyawan as any, event.url.searchParams.get('project_id')));
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => null);
	if (!body || body.project_id == null) throw error(400, 'project_id wajib diisi.');
	try {
		return json(await submitGoldenPledge(karyawan as any, body.project_id));
	} catch (e) {
		if (e instanceof GoldenRulesError) throw error(e.status, e.message);
		console.error('[api/ess/golden-rules] POST gagal:', e);
		throw error(500, 'Gagal mencatat ikrar.');
	}
};
