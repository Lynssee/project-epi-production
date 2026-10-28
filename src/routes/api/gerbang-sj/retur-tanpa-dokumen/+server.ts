// RSM-04 — truk retur tanpa dokumen: catat sebagai dokumen karantina (jangan ditolak di gerbang).
import { json, type RequestHandler } from '@sveltejs/kit';
import { gateRoute, resolveGateActor } from '$lib/server/gerbangSj/actor';
import { catatTanpaDokumen } from '$lib/server/gerbangSj/retur';
import { GateError } from '$lib/server/gerbangSj/types';

export const POST: RequestHandler = (event) =>
	gateRoute(async () => {
		const actor = await resolveGateActor(event);
		const body = await event.request.json().catch(() => null);
		if (!body) throw new GateError(400, 'INPUT_TIDAK_VALID', 'Body tidak valid.');
		return json(await catatTanpaDokumen(body, actor));
	});
