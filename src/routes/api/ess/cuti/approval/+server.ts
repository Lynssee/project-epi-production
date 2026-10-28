import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listPendingCutiForDivisi, listHistoryCutiForDivisi } from '$lib/server/ess/cuti';
import { fetchKaryawanMapByIds } from '$lib/server/ess/karyawan';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	// Guard di sini: divisi sama + bukan pengajuan sendiri.
	const [inbox, history] = await Promise.all([
		listPendingCutiForDivisi(karyawan.divisi || '', karyawan.id),
		listHistoryCutiForDivisi(karyawan.divisi || '', karyawan.id)
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

	return json({ inbox: enrichedInbox, history: enrichedHistory, divisi: karyawan.divisi });
};


