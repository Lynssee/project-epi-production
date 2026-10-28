import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getPatrolControlSettings } from '$lib/server/patrolControlSettings';
import { resolveGateMode } from '$lib/server/gateDefinitionsMode';

/** Setelan Kontrol Patroli (Fase 1) untuk klien lapangan — velocity check, durasi minimal,
 *  mode input manual, GPS enforcement, gallery upload, wajib cek ruangan, + mode gate
 *  G_PATROL_SPEEDRUN_SELESAI_RONDA (Fase 3, dibaca dari gate_definitions — Fase 4.3). */
export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	const [settings, speedrunGateMode] = await Promise.all([
		getPatrolControlSettings(),
		resolveGateMode('G_PATROL_SPEEDRUN_SELESAI_RONDA', 'patrol_session')
	]);
	return json({ ...settings, speedrunGateMode });
};
