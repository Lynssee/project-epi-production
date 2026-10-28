// src/routes/api/panduan/bookmarks/+server.ts
// Bookmark/pin panduan favorit per user — §6 Fase 3 (implementation_plan_
// panduan pertajam.md), koleksi Directus panduan_bookmarks SATU yang sama
// dengan erp-epi-1. user.email SELALU dari authenticateEss, TIDAK PERNAH
// dipercaya dari body request.
//
// - GET    : daftar bookmark user login.
// - POST   : tambah bookmark {modul_slug}. Idempotent.
// - DELETE : hapus bookmark ?modul_slug=... milik user login.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

export const GET: RequestHandler = async (event) => {
	const { user } = await authenticateEss(event);
	if (!user.email) return json({ success: true, data: [] });
	const res = await directusServerJson<{ data: any[] }>(
		`/items/panduan_bookmarks?filter[user_email][_eq]=${encodeURIComponent(user.email)}&sort=-date_created&limit=-1`
	);
	return json({ success: true, data: res?.data || [] });
};

export const POST: RequestHandler = async (event) => {
	const { user } = await authenticateEss(event);
	if (!user.email) throw error(400, 'Email user tidak ditemukan pada sesi.');

	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Body harus JSON');
	}

	const modulSlug = String(body?.modul_slug || '').trim();
	if (!modulSlug) throw error(400, 'modul_slug wajib diisi');

	const existingRes = await directusServerJson<{ data: any[] }>(
		`/items/panduan_bookmarks?filter[user_email][_eq]=${encodeURIComponent(user.email)}&filter[modul_slug][_eq]=${encodeURIComponent(modulSlug)}&limit=1`
	);
	if (existingRes?.data?.length) {
		return json({ success: true, data: existingRes.data[0] });
	}

	const created = await directusServerJson('/items/panduan_bookmarks', {
		method: 'POST',
		body: JSON.stringify({ user_email: user.email, modul_slug: modulSlug, target_app: 'project-epi' })
	});
	return json({ success: true, data: (created as any)?.data || created });
};

export const DELETE: RequestHandler = async (event) => {
	const { user } = await authenticateEss(event);
	if (!user.email) throw error(400, 'Email user tidak ditemukan pada sesi.');

	const modulSlug = event.url.searchParams.get('modul_slug');
	if (!modulSlug) throw error(400, 'modul_slug wajib diisi');

	const existingRes = await directusServerJson<{ data: any[] }>(
		`/items/panduan_bookmarks?filter[user_email][_eq]=${encodeURIComponent(user.email)}&filter[modul_slug][_eq]=${encodeURIComponent(modulSlug)}&limit=1`
	);
	const row = existingRes?.data?.[0];
	if (row) {
		await directusServerJson(`/items/panduan_bookmarks/${row.id}`, { method: 'DELETE' });
	}
	return json({ success: true });
};
