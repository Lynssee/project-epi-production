// Personal Bookmarks & Quick Access — update & delete, ownership-checked.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { updateBookmark, deleteBookmark } from '$lib/server/ess/bookmarks';

export const PATCH: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const bookmarkId = Number(event.params.id);
	if (!Number.isFinite(bookmarkId)) throw error(400, 'ID bookmark tidak valid.');

	const body = await event.request.json();
	const patch: Record<string, any> = {};
	if (body.label !== undefined) patch.label = String(body.label).trim();
	if (body.url !== undefined) patch.url = String(body.url).trim();
	if (body.icon !== undefined) patch.icon = body.icon || null;

	try {
		const bookmark = await updateBookmark(karyawan.id, bookmarkId, patch);
		return json({ bookmark });
	} catch (e: any) {
		throw error(404, e?.message || 'Bookmark tidak ditemukan.');
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const bookmarkId = Number(event.params.id);
	if (!Number.isFinite(bookmarkId)) throw error(400, 'ID bookmark tidak valid.');

	try {
		await deleteBookmark(karyawan.id, bookmarkId);
		return json({ ok: true });
	} catch (e: any) {
		throw error(404, e?.message || 'Bookmark tidak ditemukan.');
	}
};
