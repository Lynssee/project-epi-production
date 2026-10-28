// src/routes/api/ess/notifikasi/+server.ts
// GET: list notifikasi in-app milik karyawan yang login + unread count (Fase 5, Notifikasi
// Terpusat v2). Pola sama persis api/ess/pengumuman/+server.ts.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listNotifications, countUnread } from '$lib/server/ess/notifikasi';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const url = event.url;
	const readParam = url.searchParams.get('read');
	const read = readParam === 'true' ? true : readParam === 'false' ? false : undefined;
	const module = url.searchParams.get('module') || undefined;
	const page = Number(url.searchParams.get('page') || '1');

	const [{ data, total }, unreadCount] = await Promise.all([
		listNotifications(karyawan.id, { read, module, page }),
		countUnread(karyawan.id)
	]);

	return json({ notifikasi: data, total, unreadCount });
};
