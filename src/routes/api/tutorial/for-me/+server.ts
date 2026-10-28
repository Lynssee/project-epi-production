// src/routes/api/tutorial/for-me/+server.ts
// GET: daftar tutorial (tutorial_role_map + tutorial_video terkait) untuk
// jabatan (posisi) user lapangan yang login, digabung status
// tutorial_progress miliknya. Fase 2, implementation_plan_tutorial aplikasi
// per role.md. Acuan role = karyawan.jabatan_id (posisi Directus), koleksi
// tutorial_* SATU DIRECTUS yang sama dipakai bersama erp-epi-1.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

const TARGET_APP = 'project-epi';

export const GET: RequestHandler = async (event) => {
	const { user, karyawan } = await authenticateEss(event);
	const posisiId = karyawan?.jabatan_id || null;

	let roleMap: any[] = [];
	if (posisiId) {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/tutorial_role_map?filter[posisi_id][_eq]=${encodeURIComponent(posisiId)}&filter[is_active][_eq]=true&filter[target_app][_in]=${TARGET_APP},both&sort=urutan&limit=-1`
		);
		roleMap = res?.data || [];
	}

	const videoRes = await directusServerJson<{ data: any[] }>(
		`/items/tutorial_video?filter[is_active][_eq]=true&filter[target_app][_in]=${TARGET_APP},both&sort=urutan&limit=-1`
	);
	const videos = videoRes?.data || [];

	const progressRes = user.email
		? await directusServerJson<{ data: any[] }>(`/items/tutorial_progress?filter[user_email][_eq]=${encodeURIComponent(user.email)}&limit=-1`)
		: null;
	const progress = progressRes?.data || [];

	return json({ success: true, data: { posisiId, roleMap, videos, progress } });
};
