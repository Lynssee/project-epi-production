// WSK-35 4b — detail SJ workshop untuk layar satpam.
import { json, type RequestHandler } from '@sveltejs/kit';
import { gateRoute, resolveGateActor } from '$lib/server/gerbangSj/actor';
import { getDetailWorkshop, isWsKey } from '$lib/server/gerbangSj/workshop';
import { GateError } from '$lib/server/gerbangSj/types';

export const GET: RequestHandler = (event) =>
	gateRoute(async () => {
		await resolveGateActor(event);
		const ws = event.params.ws;
		const id = Number(event.params.id);
		if (!isWsKey(ws) || !Number.isInteger(id) || id <= 0) throw new GateError(400, 'INPUT_TIDAK_VALID', 'Workshop atau ID SJ tidak valid.');
		return json({ ok: true, detail: await getDetailWorkshop(ws, id) });
	});
