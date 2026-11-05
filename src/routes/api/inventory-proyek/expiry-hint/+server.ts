// src/routes/api/inventory-proyek/expiry-hint/+server.ts
// Rencana Expired Date v2 Fase 5 — petunjuk kadaluarsa batch aktif per barang untuk layar lapangan
// (kiosk cek-stok, kiosk konsumsi, stok lapangan). Satu panggilan untuk banyak barang (maks. 200), bukan per baris.
//   GET ?item_ids=1,2,3 → { agingHari, items: { [itemId]: { terdekat, status, label, jumlahBatch, tanpaTanggal } } }
// READ-ONLY. Gagal = layar menyembunyikan badge (tidak memblokir pekerjaan lapangan).
import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { buildExpiryHints, parseItemIds } from '$lib/server/expiryLapangan';

export async function GET(event: RequestEvent) {
	await requireUser(event);
	const ids = parseItemIds(event.url.searchParams.get('item_ids'));
	if (!ids.length) throw error(400, 'item_ids wajib (angka dipisah koma).');
	try {
		return json(await buildExpiryHints(ids));
	} catch (e: any) {
		console.error('[expiry-hint] gagal:', e?.message || e);
		throw error(502, `Petunjuk kadaluarsa gagal dimuat: ${e?.message || 'kesalahan Directus'}`);
	}
}
