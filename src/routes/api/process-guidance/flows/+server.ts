// src/routes/api/process-guidance/flows/+server.ts
// GET: alur peta bisnis TERBIT untuk aplikasi lapangan (pintasan = actions_field, tanpa gate). Wajib login (authenticateEss).
//   Sukses            -> { success: true, source: 'directus', flows }   (flows kosong = memang tidak ada alur terbit, bukan error)
//   Directus gagal    -> { success: true, source: 'fallback', flows: [] } → klien memakai salinan lokal (processGuidance.ts)
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { loadPublishedFlowsForField } from '$lib/server/processGuidanceFlows';

export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	try {
		const flows = await loadPublishedFlowsForField();
		return json({ success: true, source: 'directus', flows });
	} catch (e) {
		console.warn('[process-guidance/flows] gagal baca Directus — klien memakai salinan lokal:', e instanceof Error ? e.message : e);
		return json({ success: true, source: 'fallback', flows: [], warning: 'Alur gagal dimuat dari server; memakai salinan lokal.' });
	}
};
