// WSK-35 4b — satpam menahan SJ workshop (jejak scan_log + notifikasi logistik; tidak mengubah data SJ).
import { json, type RequestHandler } from '@sveltejs/kit';
import { gateRoute, resolveGateActor } from '$lib/server/gerbangSj/actor';
import { isWsKey, tahanWorkshop } from '$lib/server/gerbangSj/workshop';
import { GateError } from '$lib/server/gerbangSj/types';

export const POST: RequestHandler = (event) =>
	gateRoute(async () => {
		const actor = await resolveGateActor(event);
		const ws = event.params.ws;
		const id = Number(event.params.id);
		if (!isWsKey(ws) || !Number.isInteger(id) || id <= 0) throw new GateError(400, 'INPUT_TIDAK_VALID', 'Workshop atau ID SJ tidak valid.');
		const body = await event.request.json().catch(() => null);
		if (!body) throw new GateError(400, 'INPUT_TIDAK_VALID', 'Body tidak valid.');
		return json(await tahanWorkshop(actor, ws, id, body));
	});
