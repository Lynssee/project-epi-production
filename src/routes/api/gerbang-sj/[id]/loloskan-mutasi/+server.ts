// RSM-13 — loloskan e-SJ Mutasi via_gudang (hanya status `dikirim`; checklist dari setelan).
import { json, type RequestHandler } from '@sveltejs/kit';
import { gateRoute, resolveGateActor } from '$lib/server/gerbangSj/actor';
import { loloskanMutasi } from '$lib/server/gerbangSj/mutasi';
import { GateError } from '$lib/server/gerbangSj/types';

export const POST: RequestHandler = (event) =>
	gateRoute(async () => {
		const actor = await resolveGateActor(event);
		const id = Number(event.params.id);
		if (!Number.isInteger(id) || id <= 0) throw new GateError(400, 'INPUT_TIDAK_VALID', 'ID dokumen mutasi tidak valid.');
		const body = await event.request.json().catch(() => null);
		if (!body) throw new GateError(400, 'INPUT_TIDAK_VALID', 'Body tidak valid.');
		return json(await loloskanMutasi(id, body, actor));
	});
