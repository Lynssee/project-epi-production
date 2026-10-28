// src/routes/api/kiosk/stok/rak/[gudangId]/barang/+server.ts
// Kelola Rak (Kiosk Gudang): cari barang master untuk DITAMBAHKAN ke rak ini. Tiap hasil
// membawa flag `sudah_di_rak` + nama rak lain tempat barang itu sudah ditempatkan.
// Query: ?q=<nama atau kode> (min 2 karakter).

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { cariBarangUntukRak } from '$lib/server/kioskStok';

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	const gudangId = Number(event.params.gudangId);
	if (!Number.isFinite(gudangId) || gudangId <= 0) throw error(400, 'ID rak tidak valid.');
	const q = (event.url.searchParams.get('q') || '').trim();
	if (q.length < 2) throw error(400, 'Ketik minimal 2 huruf untuk mencari barang.');

	const hits = await cariBarangUntukRak(q, gudangId);
	return json({ q, hits });
};
