// src/routes/api/kiosk/stok/cari/+server.ts
// Cari barang lintas rak dari terminal Kiosk Gudang: "barang X ada di rak mana + qty berapa".
// Guard: sesi kiosk. Query: ?q=<nama atau kode> (min 2 karakter).
// Fase 1, rencana "Penajaman Kiosk Inventory — Cek Lokasi Rak & Qty Barang" (8 Sep 2026).

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { cariBarangLintasRak } from '$lib/server/kioskStok';

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	const q = (event.url.searchParams.get('q') || '').trim();
	if (q.length < 2) throw error(400, 'Ketik minimal 2 huruf untuk mencari barang.');

	const hits = await cariBarangLintasRak(q);
	return json({ q, hits });
};
