// src/routes/api/kiosk/gerbang-sj/foto/+server.ts
// GSP-01 §4.4 — PEMBUNGKUS TIPIS masa transisi: unggah foto = uploadFotoGerbang (satu handler dgn app & ERP).
// Respons lama dipertahankan ({ file_id }). Tidak ada layar yang memakainya lagi; hapus setelah GSP-11 lulus.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { resolveGateActor, toKitError } from '$lib/server/gerbangSj/actor';
import { uploadFotoGerbang } from '$lib/server/gerbangSj/actions';

export const POST: RequestHandler = async (event) => {
	const actor = await resolveGateActor(event).catch(toKitError);
	const form = await event.request.formData().catch(() => null);
	const file = form?.get('foto');
	const sjId = Number(form?.get('sjId'));
	if (!Number.isInteger(sjId) || sjId <= 0) throw error(400, 'sjId tidak valid.');
	if (!(file instanceof File)) throw error(400, 'File foto tidak ada.');
	const fileId = await uploadFotoGerbang(sjId, file, actor).catch(toKitError);
	return json({ file_id: fileId });
};
