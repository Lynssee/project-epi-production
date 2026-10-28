import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listPendingKasbonForKepala, listHistoryKasbonForKepala } from '$lib/server/ess/kasbon';
import { fetchKaryawanMapByIds } from '$lib/server/ess/karyawan';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	// Fase 2 (Q3, T5): inbox tahap-1 sekarang berbasis kepala divisi/unit, bukan "divisi sama".
	const [inbox, history] = await Promise.all([
		listPendingKasbonForKepala(karyawan.id, karyawan.divisi || '', karyawan.id),
		listHistoryKasbonForKepala(karyawan.id, karyawan.divisi || '', karyawan.id)
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


