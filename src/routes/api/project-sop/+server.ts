// src/routes/api/project-sop/+server.ts
// GET: instruksi/SOP khusus untuk proyek "aktif hari ini" milik user login
// — §7B #3 (implementation_plan_panduan + video generator.md). Dikelola
// admin di erp-epi-1 /settings/project-sop (koleksi Directus SATU yang sama:
// project_sop_notes). Read-only di sini, tidak ada CRUD.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { getCurrentProjectId } from '$lib/server/currentProjectResolver';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	if (!karyawan?.id) return json({ success: true, data: { projectId: null, notes: [] } });

	const projectId = await getCurrentProjectId(karyawan.id);
	if (!projectId) return json({ success: true, data: { projectId: null, notes: [] } });

	const res = await directusServerJson<{ data: any[] }>(
		`/items/project_sop_notes?filter[project_id][_eq]=${projectId}&filter[is_active][_eq]=true&sort=urutan&limit=-1`
	);

	return json({ success: true, data: { projectId, notes: res?.data || [] } });
};
