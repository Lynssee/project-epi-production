// GSP-01 — Tahan SJ di gerbang (status SJ tidak berubah). Aturan & efek: lib/server/gerbangSj/actions.ts (GSP-06).
import { json, type RequestHandler } from '@sveltejs/kit';
import { gateRoute, resolveGateActor } from '$lib/server/gerbangSj/actor';
import { tahan } from '$lib/server/gerbangSj/actions';
import { GateError } from '$lib/server/gerbangSj/types';

export const POST: RequestHandler = (event) =>
	gateRoute(async () => {
		const actor = await resolveGateActor(event);
		const id = Number(event.params.id);
		if (!Number.isInteger(id) || id <= 0) throw new GateError(400, 'INPUT_TIDAK_VALID', 'ID SJ tidak valid.');
		const body = await event.request.json().catch(() => null);
		if (!body) throw new GateError(400, 'INPUT_TIDAK_VALID', 'Body tidak valid.');
		return json(await tahan(id, body, actor));
	});
