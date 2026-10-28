import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listPendingReimburseForDivisi, listHistoryReimburseForDivisi } from '$lib/server/ess/reimburse';
import { fetchKaryawanMapByIds } from '$lib/server/ess/karyawan';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const [inbox, history] = await Promise.all([
		listPendingReimburseForDivisi(karyawan.divisi || '', karyawan.id),
		listHistoryReimburseForDivisi(karyawan.divisi || '', karyawan.id)
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


