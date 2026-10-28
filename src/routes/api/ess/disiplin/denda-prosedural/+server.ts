import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listMyDendaProsedural } from '$lib/server/ess/dendaProsedural';

// GET /api/ess/disiplin/denda-prosedural?periode=YYYY-MM
// Daftar denda prosedural (read-only) milik karyawan ybs. Fase 3.
export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const periode = event.url.searchParams.get('periode') || undefined;
	const logs = await listMyDendaProsedural(karyawan.id, periode);
	return json({ logs });
};
