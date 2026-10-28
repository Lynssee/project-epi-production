// WSK-35 4b — cari SJ workshop lewat scan QR (token WAJIB cocok) atau ketik nomor SJ.
import { json, type RequestHandler } from '@sveltejs/kit';
import { gateRoute, resolveGateActor } from '$lib/server/gerbangSj/actor';
import { cariWorkshop } from '$lib/server/gerbangSj/workshop';

export const POST: RequestHandler = (event) =>
	gateRoute(async () => {
		await resolveGateActor(event);
		const body = await event.request.json().catch(() => ({}));
		return json({ ok: true, detail: await cariWorkshop({ code: body?.code, nomor: body?.nomor }) });
	});
