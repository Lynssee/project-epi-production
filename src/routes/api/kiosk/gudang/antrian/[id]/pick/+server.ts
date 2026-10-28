// src/routes/api/kiosk/gudang/antrian/[id]/pick/+server.ts
// Submit picking satu item dari antrian, dari terminal Kiosk Gudang. Diatribusikan ke pemegang
// badge. Guard: sesi kiosk. Fase 3, rencana "Penajaman Kiosk Inventory" (8 Sep 2026).

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';
import { submitPickKiosk } from '$lib/server/kioskGudang';

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'gudang_pick', 'Ambil Barang (Picking)');
	const packingListId = Number(event.params.id);
	if (!Number.isFinite(packingListId) || packingListId <= 0) throw error(400, 'ID antrian tidak valid.');

	const body = await event.request.json().catch(() => null);
	if (!body) throw error(400, 'Body tidak valid.');

	const packing_list_item_id = Number(body.packing_list_item_id);
	const item_id = Number(body.item_id);
	const quantity = Number(body.quantity);
	const client_txn_id = String(body.client_txn_id || '').trim();
	// File 06 §2.3 — opsional untuk kompatibilitas klien lama (cache PWA belum memilih rak):
	// tetap diterima tanpa rak dan dicatat warn, JANGAN ditolak (Aturan #3).
	const from_rak_id = Number(body.from_rak_id);
	if (!Number.isFinite(packing_list_item_id) || packing_list_item_id <= 0) throw error(400, 'Item tidak valid.');
	if (!Number.isFinite(item_id) || item_id <= 0) throw error(400, 'Barang tidak valid.');
	if (!client_txn_id) throw error(400, 'client_txn_id wajib.');
	if (!(Number.isFinite(from_rak_id) && from_rak_id > 0)) {
		console.warn('[gudang/antrian/pick] picking tanpa from_rak_id (klien lama?)', { packingListId, packing_list_item_id });
	}

	const result = await submitPickKiosk({
		packing_list_id: packingListId,
		packing_list_item_id,
		item_id,
		quantity,
		client_txn_id,
		karyawan_id: session.karyawanId,
		karyawan_nama: session.nama,
		from_rak_id: Number.isFinite(from_rak_id) && from_rak_id > 0 ? from_rak_id : null
	});

	if (!result.ok) throw error(result.status ?? 400, result.error);
	return json(result);
};
