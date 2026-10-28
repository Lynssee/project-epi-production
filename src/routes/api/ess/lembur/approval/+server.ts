import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listPendingLemburForDivisi, listHistoryLemburForDivisi } from '$lib/server/ess/lembur';
import { fetchKaryawanMapByIds } from '$lib/server/ess/karyawan';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const [inbox, history] = await Promise.all([
		listPendingLemburForDivisi(karyawan.divisi || '', karyawan.id),
		listHistoryLemburForDivisi(karyawan.divisi || '', karyawan.id)
	]);

	// Directus separated relation fetch
	const allKaryawanIds = [...inbox.map((item) => item.karyawan_id), ...history.map((item) => item.karyawan_id)];
	const karyawanMap = await fetchKaryawanMapByIds(allKaryawanIds);

	const enrichedInbox = inbox.map((item) => ({
		...item,
		karyawan: karyawanMap.get(String(item.karyawan_id)) || null
	}));
	const enrichedHistory = history.map((item) => ({
		...item,
		karyawan: karyawanMap.get(String(item.karyawan_id)) || null
	}));

	return json({ inbox: enrichedInbox, history: enrichedHistory });
};


