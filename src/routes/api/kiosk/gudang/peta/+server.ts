// src/routes/api/kiosk/gudang/peta/+server.ts
// Data peta gudang untuk Kiosk: daftar denah (gambar + pin rak) + pohon gudang (fallback).
// Guard: sesi kiosk. Fase 4, rencana "Penajaman Kiosk Inventory" (8 Sep 2026).

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { fetchPetaKiosk } from '$lib/server/kioskStok';

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	return json(await fetchPetaKiosk());
};
