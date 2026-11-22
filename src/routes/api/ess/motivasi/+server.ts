import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getMotivasiStatus, submitMotivasi, MotivasiError } from '$lib/server/ess/motivasiServer';

// GET  = status cek-in semangat karyawan login ({ enabled, due, faktor }).
// POST = kirim cek-in; identitas dari login, tipe/periode divalidasi di server.
export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	return json(await getMotivasiStatus(karyawan as any));
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => null);
	if (!body) throw error(400, 'Body JSON wajib diisi.');
	try {
		return json(await submitMotivasi(karyawan as any, body));
	} catch (e) {
		if (e instanceof MotivasiError) throw error(e.status, e.message);
		console.error('[api/ess/motivasi] POST gagal:', e);
		throw error(500, 'Gagal menyimpan cek-in semangat.');
	}
};
