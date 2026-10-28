// GSP-01 — detail SJ gerbang: header + item + checklist ternormalisasi + hasil aturan (can_pass, blockers, warnings).
import { json, type RequestHandler } from '@sveltejs/kit';
import { gateRoute, resolveGateActor } from '$lib/server/gerbangSj/actor';
import { getDetail, publicDetail } from '$lib/server/gerbangSj/query';
import { GateError } from '$lib/server/gerbangSj/types';

export const GET: RequestHandler = (event) =>
	gateRoute(async () => {
		await resolveGateActor(event);
		const id = Number(event.params.id);
		if (!Number.isInteger(id) || id <= 0) throw new GateError(400, 'INPUT_TIDAK_VALID', 'ID SJ tidak valid.');
		return json({ ok: true, ...publicDetail(await getDetail(id)) });
	});
