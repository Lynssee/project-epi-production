// src/routes/api/kiosk/gerbang-sj/loloskan/+server.ts
// GSP-01 — PEMBUNGKUS TIPIS masa transisi. Logika ada di lib/server/gerbangSj (satu pintu bersama app & ERP).
// Bentuk respons lama dipertahankan ({ success, already_passed | newStatus }) supaya layar kiosk lama tetap jalan.
// `legacy`: layar kiosk lama belum mengirim koli_dihitung / cek per item (GSP-08 menyusul). Hapus setelah GSP-11 lulus.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { resolveGateActor, toKitError } from '$lib/server/gerbangSj/actor';
import { loloskan } from '$lib/server/gerbangSj/actions';

export const POST: RequestHandler = async (event) => {
	const actor = await resolveGateActor(event).catch(toKitError);
	const body = await event.request.json().catch(() => null);
	if (!body) throw error(400, 'Body tidak valid.');
	const sjId = Number(body.sjId);
	if (!Number.isFinite(sjId) || sjId <= 0) throw error(400, 'sjId tidak valid.');

	const out = await loloskan(sjId, body, actor, { legacy: true }).catch(toKitError);
	return out.idempoten ? json({ success: true, already_passed: true }) : json({ success: true, newStatus: 'shipped' });
};
