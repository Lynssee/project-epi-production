// RSM-04 — tahan retur di gerbang (status dokumen TIDAK berubah; gudang diberi tahu).
import { json, type RequestHandler } from '@sveltejs/kit';
import { gateRoute, resolveGateActor } from '$lib/server/gerbangSj/actor';
import { tahanRetur } from '$lib/server/gerbangSj/retur';
import { GateError } from '$lib/server/gerbangSj/types';

export const POST: RequestHandler = (event) =>
	gateRoute(async () => {
		const actor = await resolveGateActor(event);
		const id = Number(event.params.id);
		if (!Number.isInteger(id) || id <= 0) throw new GateError(400, 'INPUT_TIDAK_VALID', 'ID dokumen retur tidak valid.');
		const body = await event.request.json().catch(() => null);
		if (!body) throw new GateError(400, 'INPUT_TIDAK_VALID', 'Body tidak valid.');
		return json(await tahanRetur(id, body, actor));
	});
