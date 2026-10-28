// Personal Bookmarks & Quick Access — list & create, privat per karyawan.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listMyBookmarks, createBookmark, reorderBookmarks } from '$lib/server/ess/bookmarks';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const bookmarks = await listMyBookmarks(karyawan.id);
	return json({ bookmarks });
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json();
	const label = String(body.label || '').trim();
	const url = String(body.url || '').trim();
	if (!label || !url) throw error(400, 'Label dan URL wajib diisi.');
	if (!url.startsWith('/')) throw error(400, 'URL harus path relatif, mis. /ess/cuti.');

	const bookmark = await createBookmark(karyawan.id, { label, url, icon: body.icon || null });
	return json({ bookmark });
};

/** Simpan ulang urutan bookmark (drag/tap reorder). */
export const PATCH: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json();
	const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds.map(Number) : [];
	if (!orderedIds.length) throw error(400, 'orderedIds wajib diisi.');

	try {
		await reorderBookmarks(karyawan.id, orderedIds);
		return json({ ok: true });
	} catch (e: any) {
		throw error(404, e?.message || 'Gagal menyimpan urutan.');
	}
};
