// Personal Notes & Quick Log — list & create, privat per karyawan.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listMyNotes, createNote } from '$lib/server/ess/notes';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const status = (event.url.searchParams.get('status') as 'active' | 'archived') || 'active';
	const type = event.url.searchParams.get('type') || undefined;
	const tag = event.url.searchParams.get('tag') || undefined;

	const notes = await listMyNotes(karyawan.id, { status, type, tag });
	return json({ notes });
};

export const POST: RequestHandler = async (event) => {
	const { karyawan, user } = await authenticateEss(event);
	const body = await event.request.json();
	const content = String(body.content || '').trim();
	if (!content) throw error(400, 'Isi catatan wajib diisi.');

	try {
		const note = await createNote(karyawan.id, user.localId || null, {
			title: body.title ? String(body.title).trim() : null,
			content,
			type: body.type,
			color: body.color || null,
			tags: Array.isArray(body.tags) ? body.tags : null,
			reminder_date: body.reminder_date || null
		});
		return json({ note });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal membuat catatan.');
	}
};
