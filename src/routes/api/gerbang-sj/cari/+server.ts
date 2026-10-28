// GSP-01 — cari SJ lewat scan QR (code) atau ketik nomor, kembalikan detail + aturan.
import { json, type RequestHandler } from '@sveltejs/kit';
import { gateRoute, resolveGateActor } from '$lib/server/gerbangSj/actor';
import { findIdByCodeOrNomor, getDetail, publicDetail } from '$lib/server/gerbangSj/query';

export const POST: RequestHandler = (event) =>
	gateRoute(async () => {
		await resolveGateActor(event);
		const body = await event.request.json().catch(() => ({}));
		const id = await findIdByCodeOrNomor({ code: body?.code, nomor: body?.nomor });
		return json({ ok: true, ...publicDetail(await getDetail(id)) });
	});
