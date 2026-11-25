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
const TUTORIAL_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_ROLE_MAP_CACHE = 200;

const roleMapCache = new Map<string, { at: number; rows: any[] }>();
const roleMapInflight = new Map<string, Promise<any[]>>();
let videoCache: { at: number; rows: any[] } | null = null;
let videoInflight: Promise<any[]> | null = null;

/** Untuk unit test / invalidasi cache tutorial. */
export function _clearTutorialForMeCache(): void {
	roleMapCache.clear();
	roleMapInflight.clear();
	videoCache = null;
	videoInflight = null;
}

async function loadRoleMap(posisiId: number | string | null): Promise<any[]> {
	if (!posisiId) return [];
	const key = String(posisiId);
	const now = Date.now();
	const cached = roleMapCache.get(key);
	if (cached && now - cached.at < TUTORIAL_CACHE_TTL_MS) return cached.rows;
	const running = roleMapInflight.get(key);
	if (running) return running;

	const pending = (async (): Promise<any[]> => {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/tutorial_role_map?filter[posisi_id][_eq]=${encodeURIComponent(key)}&filter[is_active][_eq]=true&filter[target_app][_in]=${TARGET_APP},both&sort=urutan&limit=-1`
		);
		const rows = res?.data || [];
		if (roleMapCache.size >= MAX_ROLE_MAP_CACHE) {
			const oldest = roleMapCache.keys().next().value;
			if (oldest !== undefined) roleMapCache.delete(oldest);
		}
		roleMapCache.set(key, { at: Date.now(), rows });
		return rows;
	})().finally(() => {
		if (roleMapInflight.get(key) === pending) roleMapInflight.delete(key);
	});

	roleMapInflight.set(key, pending);
	return pending;
}

async function loadTutorialVideos(): Promise<any[]> {
	const now = Date.now();
	if (videoCache && now - videoCache.at < TUTORIAL_CACHE_TTL_MS) return videoCache.rows;
	if (videoInflight) return videoInflight;

	const pending = (async (): Promise<any[]> => {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/tutorial_video?filter[is_active][_eq]=true&filter[target_app][_in]=${TARGET_APP},both&sort=urutan&limit=-1`
		);
		const rows = res?.data || [];
		videoCache = { at: Date.now(), rows };
		return rows;
	})().finally(() => {
		if (videoInflight === pending) videoInflight = null;
	});

	videoInflight = pending;
	return pending;
}

export const GET: RequestHandler = async (event) => {
	const { user, karyawan } = await authenticateEss(event);
	const posisiId = karyawan?.jabatan_id || null;

	const [roleMap, videos, progressRes] = await Promise.all([
		loadRoleMap(posisiId),
		loadTutorialVideos(),
		user.email
			? directusServerJson<{ data: any[] }>(`/items/tutorial_progress?filter[user_email][_eq]=${encodeURIComponent(user.email)}&limit=-1`)
			: Promise.resolve(null)
	]);
	const progress = progressRes?.data || [];

	return json({ success: true, data: { posisiId, roleMap, videos, progress } });
};
