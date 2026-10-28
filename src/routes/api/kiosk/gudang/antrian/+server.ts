// src/routes/api/kiosk/gudang/antrian/+server.ts
// Daftar antrian persiapan (packing_list) untuk terminal Kiosk Gudang. Guard: sesi kiosk.
// Fase 3, rencana "Penajaman Kiosk Inventory — Cek Lokasi Rak & Qty Barang" (8 Sep 2026).

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { listAntrian, readGudangHqGate } from '$lib/server/kioskGudang';

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	const [gate, rows] = await Promise.all([readGudangHqGate(), listAntrian()]);
	return json({ gate, rows });
};
