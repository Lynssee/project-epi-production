// src/routes/api/kiosk/stok/rak/[gudangId]/placement/+server.ts
// Kelola Rak (Kiosk Gudang): tempatkan barang ke rak ini. Hanya master penempatan
// (gudang_item_placement) — TIDAK menulis stok. Atribusi badge dicatat ke scan_log.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';
import { tambahPlacement, TAMBAH_PLACEMENT_MAX } from '$lib/server/kioskStok';

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'gudang_stok', 'Cek Stok & Kelola Rak');
	const gudangId = Number(event.params.gudangId);
	if (!Number.isFinite(gudangId) || gudangId <= 0) throw error(400, 'ID rak tidak valid.');

	const body = await event.request.json().catch(() => null);
	if (!body) throw error(400, 'Body tidak valid.');
	// Body: { items: [{ item_id, expected_qty? }, ...] } — atau bentuk lama { item_id, expected_qty? }.
	const rawItems: any[] = Array.isArray(body.items) ? body.items : [body];
	if (rawItems.length > TAMBAH_PLACEMENT_MAX) throw error(400, `Maksimal ${TAMBAH_PLACEMENT_MAX} barang sekali tambah.`);
	const items = rawItems.map((r) => {
		const item_id = Number(r?.item_id);
		if (!Number.isFinite(item_id) || item_id <= 0) throw error(400, 'Barang tidak valid.');
		const raw = r?.expected_qty;
		return { item_id, expected_qty: raw === null || raw === undefined || raw === '' ? null : Number(raw) };
	});

	let result;
	try {
		result = await tambahPlacement({
			gudang_id: gudangId,
			items,
			actor: { karyawan_id: session.karyawanId, karyawan_nama: session.nama }
		});
	} catch (e) {
		console.error('[api/kiosk/stok/placement] tambah gagal', e);
		throw error(502, 'Gagal menyimpan ke server. Coba lagi.');
	}
	if (!result.ok) throw error(result.status, result.error);
	return json(result);
};
