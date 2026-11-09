// src/routes/api/kiosk/stok/rak/[gudangId]/+server.ts
// Detail satu rak untuk terminal Kiosk Gudang. Satu panggilan = master rak + item + qty
// ledger + PIC + denah (hemat roundtrip). Guard: sesi kiosk (cookie epi_kiosk_session).
// Fase 1, rencana "Penajaman Kiosk Inventory — Cek Lokasi Rak & Qty Barang" (8 Sep 2026).

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { fetchRakDetail } from '$lib/server/kioskStok';
import { bolehAdjustRak } from '$lib/server/kioskGudang';

export const GET: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	const gudangId = Number(event.params.gudangId);
	if (!Number.isFinite(gudangId) || gudangId <= 0) throw error(400, 'ID rak tidak valid.');

	const detail = await fetchRakDetail(gudangId);
	if (!detail) throw error(404, 'Rak tidak ditemukan.');

	// Hanya untuk menampilkan tombol; endpoint adjust memeriksa ulang izinnya.
	const boleh_adjust = await bolehAdjustRak(session.karyawanId, detail.gudang).catch(() => false);
	return json({ ...detail, boleh_adjust });
};
