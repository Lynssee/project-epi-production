// GSP-01 — unggah 1 foto muatan gerbang → { file_id }. Multipart field `foto`, maks 8 MB.
import { json, type RequestHandler } from '@sveltejs/kit';
import { gateRoute, resolveGateActor } from '$lib/server/gerbangSj/actor';
import { uploadFotoGerbang } from '$lib/server/gerbangSj/actions';
import { GateError } from '$lib/server/gerbangSj/types';

export const POST: RequestHandler = (event) =>
	gateRoute(async () => {
		const actor = await resolveGateActor(event);
		const id = Number(event.params.id);
		if (!Number.isInteger(id) || id <= 0) throw new GateError(400, 'INPUT_TIDAK_VALID', 'ID SJ tidak valid.');
		const form = await event.request.formData().catch(() => null);
		const file = form?.get('foto');
		if (!(file instanceof File)) throw new GateError(400, 'INPUT_TIDAK_VALID', 'File foto tidak ada.');
		return json({ ok: true, file_id: await uploadFotoGerbang(id, file, actor) });
	});
