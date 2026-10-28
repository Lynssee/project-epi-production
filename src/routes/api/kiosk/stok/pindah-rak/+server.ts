// src/routes/api/kiosk/stok/pindah-rak/+server.ts
// Pindah lokasi rak dari terminal Kiosk Gudang. Eksekusi LANGSUNG, diatribusikan ke pemegang
// badge (sesi kiosk). BUKAN pengeluaran barang — stok global tidak berubah, hanya qty antar rak.
// Fase 2, rencana "Penajaman Kiosk Inventory — Cek Lokasi Rak & Qty Barang" (8 Sep 2026).

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';
import { pindahRak } from '$lib/server/kioskStok';

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'gudang_stok', 'Cek Stok & Pindah Rak');
	const body = await event.request.json().catch(() => null);
	if (!body) throw error(400, 'Body tidak valid.');

	const item_id = Number(body.item_id);
	const rak_asal_id = Number(body.rak_asal_id);
	const rak_tujuan_id = Number(body.rak_tujuan_id);
	const qty = Number(body.qty);
	const client_txn_id = String(body.client_txn_id || '').trim();

	if (!Number.isFinite(item_id) || item_id <= 0) throw error(400, 'Barang tidak valid.');
	if (!Number.isFinite(rak_asal_id) || rak_asal_id <= 0) throw error(400, 'Rak asal tidak valid.');
	if (!Number.isFinite(rak_tujuan_id) || rak_tujuan_id <= 0) throw error(400, 'Rak tujuan tidak valid.');
	if (!client_txn_id) throw error(400, 'client_txn_id wajib (untuk anti-duplikat).');

	const result = await pindahRak({
		item_id,
		rak_asal_id,
		rak_tujuan_id,
		qty,
		client_txn_id,
		karyawan_id: session.karyawanId,
		karyawan_nama: session.nama,
		catatan: body.catatan ? String(body.catatan).trim().slice(0, 500) : null,
		foto_file_id: body.foto_file_id ? String(body.foto_file_id) : null
	});

	if (!result.ok) throw error(result.status ?? 400, result.error);
	return json(result);
};
