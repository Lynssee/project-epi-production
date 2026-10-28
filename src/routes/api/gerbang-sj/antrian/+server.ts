// GSP-01 — antrian SJ gerbang, SATU sumber untuk kiosk · app HP · ERP (via proxy).
import { json, type RequestHandler } from '@sveltejs/kit';
import { gateRoute, resolveGateActor } from '$lib/server/gerbangSj/actor';
import { getAntrian } from '$lib/server/gerbangSj/query';

export const GET: RequestHandler = (event) =>
	gateRoute(async () => {
		const actor = await resolveGateActor(event);
		const { count, antrian } = await getAntrian();
		return json({ ok: true, aktor: { nama: actor.nama, sumber: actor.sumber }, count, antrian, generated_at: new Date().toISOString() });
	});
