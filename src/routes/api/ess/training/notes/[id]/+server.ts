import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { deleteNote } from '$lib/server/ess/training';

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
