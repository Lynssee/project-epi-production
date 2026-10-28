// Personal Notes & Quick Log — update (pin/archive/edit) & delete, ownership-checked.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { updateNote, deleteNote } from '$lib/server/ess/notes';

export const PATCH: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const noteId = Number(event.params.id);
	if (!Number.isFinite(noteId)) throw error(400, 'ID catatan tidak valid.');

	const body = await event.request.json();
	const patch: Record<string, any> = {};
	if (body.title !== undefined) patch.title = body.title ? String(body.title).trim() : null;
	if (body.content !== undefined) patch.content = String(body.content).trim();
	if (body.is_pinned !== undefined) patch.is_pinned = !!body.is_pinned;
	if (body.color !== undefined) patch.color = body.color || null;
	if (body.tags !== undefined) patch.tags = Array.isArray(body.tags) ? body.tags : null;
	if (body.status !== undefined) patch.status = body.status === 'archived' ? 'archived' : 'active';

	try {
		const note = await updateNote(karyawan.id, noteId, patch);
		return json({ note });
	} catch (e: any) {
		throw error(404, e?.message || 'Catatan tidak ditemukan.');
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const noteId = Number(event.params.id);
	if (!Number.isFinite(noteId)) throw error(400, 'ID catatan tidak valid.');

	try {
		await deleteNote(karyawan.id, noteId);
		return json({ ok: true });
	} catch (e: any) {
		throw error(404, e?.message || 'Catatan tidak ditemukan.');
	}
};
