// src/routes/api/kiosk/stok/rak/[gudangId]/placement/[placementId]/+server.ts
// Kelola Rak (Kiosk Gudang):
//  - DELETE: lepas item dari rak ini (diblokir kalau stok tercatat di rak > 0).
//  - PATCH { rak_tujuan_id }: pindah LOKASI penempatan saja, tanpa qty (untuk item yang stok
//    tercatatnya kosong). Item yang masih punya stok wajib lewat /api/kiosk/stok/pindah-rak.
// Hanya master penempatan (gudang_item_placement) — TIDAK menulis stok.

import { json, error, type RequestHandler, type RequestEvent } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';
import { hapusPlacement, pindahPlacement } from '$lib/server/kioskStok';

async function guard(event: RequestEvent) {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'gudang_stok', 'Cek Stok & Kelola Rak');
	const gudangId = Number(event.params.gudangId);
	const placementId = Number(event.params.placementId);
	if (!Number.isFinite(gudangId) || gudangId <= 0) throw error(400, 'ID rak tidak valid.');
	if (!Number.isFinite(placementId) || placementId <= 0) throw error(400, 'ID penempatan tidak valid.');
	return { session, gudangId, placementId };
}

export const DELETE: RequestHandler = async (event) => {
	const { session, gudangId, placementId } = await guard(event);
	let result;
	try {
		result = await hapusPlacement({
			gudang_id: gudangId,
			placement_id: placementId,
			actor: { karyawan_id: session.karyawanId, karyawan_nama: session.nama }
		});
	} catch (e) {
		console.error('[api/kiosk/stok/placement] hapus gagal', e);
		throw error(502, 'Gagal menghapus di server. Coba lagi.');
	}
	if (!result.ok) throw error(result.status, result.error);
	return json(result);
};

export const PATCH: RequestHandler = async (event) => {
	const { session, gudangId, placementId } = await guard(event);
	const body = await event.request.json().catch(() => null);
	const rak_tujuan_id = Number(body?.rak_tujuan_id);
	if (!Number.isFinite(rak_tujuan_id) || rak_tujuan_id <= 0) throw error(400, 'Rak tujuan tidak valid.');

	let result;
	try {
		result = await pindahPlacement({
			gudang_id: gudangId,
			placement_id: placementId,
			rak_tujuan_id,
			actor: { karyawan_id: session.karyawanId, karyawan_nama: session.nama }
		});
	} catch (e) {
		console.error('[api/kiosk/stok/placement] pindah gagal', e);
		throw error(502, 'Gagal memindahkan di server. Coba lagi.');
	}
	if (!result.ok) throw error(result.status, result.error);
	return json(result);
};
