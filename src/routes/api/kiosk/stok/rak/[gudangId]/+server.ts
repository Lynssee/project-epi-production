// src/routes/api/kiosk/stok/rak/[gudangId]/+server.ts
// Detail satu rak untuk terminal Kiosk Gudang. Satu panggilan = master rak + item + qty
// ledger + PIC + denah (hemat roundtrip). Guard: sesi kiosk (cookie epi_kiosk_session).
// Fase 1, rencana "Penajaman Kiosk Inventory — Cek Lokasi Rak & Qty Barang" (8 Sep 2026).

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { fetchRakDetail } from '$lib/server/kioskStok';

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	const gudangId = Number(event.params.gudangId);
	if (!Number.isFinite(gudangId) || gudangId <= 0) throw error(400, 'ID rak tidak valid.');

	const detail = await fetchRakDetail(gudangId);
	if (!detail) throw error(404, 'Rak tidak ditemukan.');

	return json(detail);
};
