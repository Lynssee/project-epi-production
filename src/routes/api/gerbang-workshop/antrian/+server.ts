// WSK-35 4b — antrean SJ Keluar workshop (Ciketing & Balaraja) yang belum diverifikasi satpam.
import { json, type RequestHandler } from '@sveltejs/kit';
import { gateRoute, resolveGateActor } from '$lib/server/gerbangSj/actor';
import { getAntrianWorkshop } from '$lib/server/gerbangSj/workshop';

export const GET: RequestHandler = (event) =>
	gateRoute(async () => {
		const actor = await resolveGateActor(event);
		const antrian = await getAntrianWorkshop();
		return json({ ok: true, aktor: { nama: actor.nama, sumber: actor.sumber }, count: antrian.length, antrian, generated_at: new Date().toISOString() });
	});
