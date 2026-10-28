// SJ-09 opsi C — antrean SJ penjualan (type = so_delivery) untuk gerbang. Aktif hanya bila
// app_settings logistik.gerbang_penjualan_aktif = true (default mati → daftar kosong, aktif: false).
import { json, type RequestHandler } from '@sveltejs/kit';
import { gateRoute, resolveGateActor } from '$lib/server/gerbangSj/actor';
import { getAntrianPenjualan } from '$lib/server/gerbangSj/penjualan';

export const GET: RequestHandler = (event) =>
	gateRoute(async () => {
		await resolveGateActor(event);
		return json({ ok: true, ...(await getAntrianPenjualan()), generated_at: new Date().toISOString() });
	});
