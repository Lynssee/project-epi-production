// src/routes/api/kiosk/gudang/persiapan/+server.ts
// Data Persiapan Harian (reorder alert, reservasi SPK, pipeline packing, stok FG) untuk Kiosk
// Gudang. Read-only. Guard: sesi kiosk. Fase 3, rencana "Penajaman Kiosk Inventory" (8 Sep 2026).

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { getPersiapanHarian, readGudangHqGate } from '$lib/server/kioskGudang';
import { getKategoriConfig } from '$lib/server/kioskStok';

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	const [gate, kategori] = await Promise.all([readGudangHqGate(), getKategoriConfig()]);
	const data = await getPersiapanHarian(kategori.fgIds);
	return json({ gate, data });
};
