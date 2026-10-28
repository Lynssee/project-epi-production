// RSM-04 — cari dokumen retur dari scan QR "EPI:RTN:<id>:<token>" atau nomor RTN.
import { json, type RequestHandler } from '@sveltejs/kit';
import { gateRoute, resolveGateActor } from '$lib/server/gerbangSj/actor';
import { cariRetur } from '$lib/server/gerbangSj/retur';

export const GET: RequestHandler = (event) =>
	gateRoute(async () => {
		await resolveGateActor(event);
		return json({ ok: true, ...(await cariRetur(event.url.searchParams.get('q') || '')) });
	});
