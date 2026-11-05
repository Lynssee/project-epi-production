// src/routes/api/kiosk/expiry-hint/+server.ts
// Rencana Expired Date v2 Fase 5 — petunjuk kadaluarsa per barang untuk layar KIOSK (cek-stok rak, konsumsi bahan).
// Sama dengan /api/inventory-proyek/expiry-hint tetapi autentikasi sesi kiosk (cookie perangkat), bukan Firebase.
//   GET ?item_ids=1,2,3 → { agingHari, items: { [itemId]: { terdekat, status, label, jumlahBatch, tanpaTanggal } } }
// READ-ONLY; gagal = kiosk menyembunyikan badge, pekerjaan operator tidak terblokir.
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { buildExpiryHints, parseItemIds } from '$lib/server/expiryLapangan';

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	const ids = parseItemIds(event.url.searchParams.get('item_ids'));
	if (!ids.length) throw error(400, 'item_ids wajib (angka dipisah koma).');
	try {
		return json(await buildExpiryHints(ids));
	} catch (e: any) {
		console.error('[kiosk/expiry-hint] gagal:', e?.message || e);
		throw error(502, `Petunjuk kadaluarsa gagal dimuat: ${e?.message || 'kesalahan Directus'}`);
	}
};
