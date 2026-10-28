// src/routes/api/release-notes/+server.ts
// GET: release notes PUBLISHED dari Directus (koleksi release_notes, SATU
// Directus yang sama dengan erp-epi-1 — dibuat di erp-epi-1 implementation_
// plan_Help System Fase 1). Fase 3: widget "Yang Baru" di /bantuan.
//
// Hanya baca status='published' — draft (termasuk hasil auto-generated dari
// n8n/Directus Flow, Fase 2) tidak pernah tampil ke user lapangan lewat sini.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

const TARGET_APP = 'project-epi';

export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);

	const limit = Math.min(10, Math.max(1, parseInt(event.url.searchParams.get('limit') || '5', 10)));
	const res = await directusServerJson<{ data: any[] }>(
		`/items/release_notes?filter[status][_eq]=published&filter[target_app][_in]=${TARGET_APP},both&sort=-tanggal_rilis&limit=${limit}`
	);

	return json({ success: true, data: res?.data || [] });
};
