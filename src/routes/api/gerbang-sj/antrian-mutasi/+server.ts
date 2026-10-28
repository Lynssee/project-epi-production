// RSM-13 — antrean e-SJ Mutasi rute via_gudang (status `dikirim`, belum lolos gerbang). Rute langsung_site tidak pernah muncul.
import { json, type RequestHandler } from '@sveltejs/kit';
import { gateRoute, resolveGateActor } from '$lib/server/gerbangSj/actor';
import { getAntrianMutasi } from '$lib/server/gerbangSj/mutasi';

export const GET: RequestHandler = (event) =>
	gateRoute(async () => {
		await resolveGateActor(event);
		return json({ ok: true, ...(await getAntrianMutasi()), generated_at: new Date().toISOString() });
	});
