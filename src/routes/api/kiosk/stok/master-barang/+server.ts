// src/routes/api/kiosk/stok/master-barang/+server.ts
// Saran autocomplete form "Daftarkan barang baru" di Kiosk Cek Stok.
// GET ?jenis=produk|warna&q=... → { hasil: [{ id, nama }] } (maks. 8, minimal 2 huruf).
// Hanya membaca nama dari master product_name / warna_fg — cukup sesi kiosk yang valid.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { cariMaster, type JenisMaster } from '$lib/server/kioskBarangBaru';

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	const jenis = event.url.searchParams.get('jenis');
	if (jenis !== 'produk' && jenis !== 'warna') throw error(400, 'Jenis harus produk atau warna.');
	const q = (event.url.searchParams.get('q') || '').slice(0, 60);
	try {
		return json({ hasil: await cariMaster(jenis as JenisMaster, q) });
	} catch (e) {
		console.error('[api/kiosk/stok/master-barang] gagal', e);
		throw error(502, 'Gagal memuat saran. Ketik manual saja.');
	}
};
