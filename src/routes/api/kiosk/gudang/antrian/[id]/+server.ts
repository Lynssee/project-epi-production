// src/routes/api/kiosk/gudang/antrian/[id]/+server.ts
// Detail satu antrian persiapan untuk Kiosk Gudang. Guard: sesi kiosk.
// Fase 3, rencana "Penajaman Kiosk Inventory" (8 Sep 2026).

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { getAntrianDetail } from '$lib/server/kioskGudang';

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	const id = Number(event.params.id);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'ID antrian tidak valid.');
	const detail = await getAntrianDetail(id);
	if (!detail) throw error(404, 'Antrian tidak ditemukan.');
	return json(detail);
};
