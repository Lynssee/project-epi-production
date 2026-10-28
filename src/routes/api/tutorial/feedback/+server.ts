// src/routes/api/tutorial/feedback/+server.ts
// POST: kirim feedback "Membantu / Tidak" + komentar opsional untuk satu
// artikel panduan — §7B #4 (implementation_plan_panduan + video generator.md).
// Ditulis ke koleksi panduan_feedback (SATU Directus yang sama dengan
// erp-epi-1), lalu ditinjau admin di erp-epi-1 /settings/tutorial tab
// Feedback (bukan endpoint ini yang menampilkannya).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

export const POST: RequestHandler = async (event) => {
	const { user } = await authenticateEss(event);

	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Body harus JSON');
	}

	const modulSlug = String(body?.modul_slug || '').trim();
	if (!modulSlug) throw error(400, 'modul_slug wajib diisi');
	if (typeof body?.helpful !== 'boolean') throw error(400, 'helpful wajib boolean');

	const payload = {
		modul_slug: modulSlug,
		helpful: body.helpful,
		komentar: body?.komentar ? String(body.komentar).slice(0, 1000) : '',
		target_app: 'project-epi',
		user_email: user.email || '',
		status: 'baru'
	};

	const created = await directusServerJson('/items/panduan_feedback', {
		method: 'POST',
		body: JSON.stringify(payload)
	});

	return json({ success: true, data: (created as any)?.data || created });
};
