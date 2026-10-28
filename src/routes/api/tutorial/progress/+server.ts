// src/routes/api/tutorial/progress/+server.ts
// POST: upsert bukti tonton/selesai tutorial (tour/video/panduan) untuk user
// lapangan login, ke koleksi Directus tutorial_progress (sama dengan
// erp-epi-1). Fase 2, implementation_plan_tutorial aplikasi per role.md.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

export const POST: RequestHandler = async (event) => {
	const { user } = await authenticateEss(event);
	if (!user.email) throw error(400, 'Email user tidak ditemukan pada sesi.');

	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Body harus JSON');
	}

	const tutorialRef = String(body?.tutorial_ref || '').trim();
	if (!tutorialRef) throw error(400, 'tutorial_ref wajib diisi');
	const jenis = ['tour', 'video', 'panduan'].includes(body?.jenis) ? body.jenis : 'panduan';
	const persen = Number.isFinite(Number(body?.persen)) ? Math.max(0, Math.min(100, Number(body.persen))) : 0;
	const status = ['belum', 'proses', 'selesai'].includes(body?.status)
		? body.status
		: persen >= 90 ? 'selesai' : persen > 0 ? 'proses' : 'belum';

	const existingRes = await directusServerJson<{ data: any[] }>(
		`/items/tutorial_progress?filter[user_email][_eq]=${encodeURIComponent(user.email)}&filter[tutorial_ref][_eq]=${encodeURIComponent(tutorialRef)}&filter[jenis][_eq]=${jenis}&limit=1`
	);
	const existing = existingRes?.data?.[0];

	const payload = { user_email: user.email, tutorial_ref: tutorialRef, jenis, persen, status };

	let saved;
	if (existing) {
		saved = await directusServerJson(`/items/tutorial_progress/${existing.id}`, {
			method: 'PATCH',
			body: JSON.stringify(payload)
		});
	} else {
		saved = await directusServerJson('/items/tutorial_progress', {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	return json({ success: true, data: (saved as any)?.data || saved });
};
