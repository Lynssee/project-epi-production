// RSM-04 — antrean MASUK retur (dokumen RTN `dikirim` yang belum lewat gerbang gudang).
import { json, type RequestHandler } from '@sveltejs/kit';
import { gateRoute, resolveGateActor } from '$lib/server/gerbangSj/actor';
import { getAntrianRetur } from '$lib/server/gerbangSj/retur';

export const GET: RequestHandler = (event) =>
	gateRoute(async () => {
		await resolveGateActor(event);
		return json({ ok: true, ...(await getAntrianRetur()), generated_at: new Date().toISOString() });
	});
