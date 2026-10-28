// src/routes/api/sj-security-check/+server.ts
// GSP-01/02 — PEMBUNGKUS TIPIS masa transisi untuk app HP lama. Logika (aturan, CAS, tahap tracking,
// gate log, notifikasi, cek patrol/P2H) ada di lib/server/gerbangSj. Beda dari sebelumnya:
// sekarang WAJIB punya peran satpam (access_security/gate_log/admin_panel) — dulu siapa pun yang login lolos.
// `legacy`: layar app lama belum mengirim koli_dihitung / cek per item (GSP-09 menyusul). Hapus setelah GSP-11 lulus.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveGateActor, toKitError } from '$lib/server/gerbangSj/actor';
import { loloskan } from '$lib/server/gerbangSj/actions';

export const POST: RequestHandler = async (event) => {
	const actor = await resolveGateActor(event).catch(toKitError);
	const body = await event.request.json().catch(() => null);
	const sjId = Number(body?.sjId);
	if (!Number.isFinite(sjId) || sjId <= 0) throw error(400, 'sjId tidak valid.');

	const cl = body?.checklist || {};
	const out = await loloskan(
		sjId,
		{
			client_event_id: String(body?.client_event_id || `app-gate-${sjId}`).slice(0, 100),
			checklist: { jumlah_ok: cl.jumlah_ok === true, plat_ok: cl.plat_ok === true, driver_ok: cl.driver_ok === true },
			foto_file_id: cl.foto || null,
			catatan: cl.catatan || null
		},
		actor,
		{ legacy: true }
	).catch(toKitError);
	return out.idempoten ? json({ success: true, already_passed: true }) : json({ success: true, newStatus: 'shipped' });
};
