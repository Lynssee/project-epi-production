import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listActivePengumuman, listReadIds } from '$lib/server/ess/pengumuman';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const items = await listActivePengumuman(karyawan.divisi);
	const readIds = await listReadIds(karyawan.id, items.map((i) => i.id));

	const pengumuman = items.map((item) => ({ ...item, is_read: readIds.has(item.id) }));
	const unreadCount = pengumuman.filter((p) => !p.is_read).length;

	return json({ pengumuman, unreadCount });
};
