// src/routes/api/kiosk/gerbang-sj/tahan/+server.ts
// GSP-01 — PEMBUNGKUS TIPIS masa transisi. Logika ada di lib/server/gerbangSj/actions.ts::tahan (GSP-06).
// Respons lama dipertahankan ({ success, idempotent? }). Kategori default 'lainnya' bila layar lama tidak mengirim.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { resolveGateActor, toKitError } from '$lib/server/gerbangSj/actor';
import { tahan } from '$lib/server/gerbangSj/actions';

export const POST: RequestHandler = async (event) => {
	const actor = await resolveGateActor(event).catch(toKitError);
	const body = await event.request.json().catch(() => null);
	const sjId = Number(body?.sjId);
	if (!Number.isFinite(sjId) || sjId <= 0) throw error(400, 'sjId tidak valid.');

	const out = await tahan(sjId, { ...body, kategori: body?.kategori || 'lainnya' }, actor).catch(toKitError);
	return out.idempoten ? json({ success: true, idempotent: true }) : json({ success: true });
};
