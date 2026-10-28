// src/routes/api/kiosk/asset/[id]/+server.ts
// Proxy aset terbatas untuk terminal Kiosk Gudang: stream file Directus pakai token server,
// TAPI hanya kalau file id itu benar-benar dipakai sebagai `gambar` di salah satu baris
// ga_denah. Ini mencegah terminal kiosk (badge+PIN, dipakai bersama) dipakai menarik file
// internal Directus sembarangan. Guard: sesi kiosk.
// Fase 4, rencana "Penajaman Kiosk Inventory — Cek Lokasi Rak & Qty Barang" (8 Sep 2026).

import { error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { directusServerFetch, directusServerJson } from '$lib/server/directus';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	const id = String(event.params.id || '');
	if (!UUID_RE.test(id)) throw error(400, 'ID aset tidak valid.');

	// Allow-list: id ini harus jadi gambar di ga_denah.
	let allowed = false;
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/ga_denah?filter[gambar][_eq]=${id}&limit=1&fields=id`
		);
		allowed = (res?.data?.length ?? 0) > 0;
	} catch (e) {
		console.warn('[kiosk/asset] gagal cek allow-list ga_denah', e);
	}
	if (!allowed) throw error(404, 'Aset tidak tersedia untuk kiosk.');

	const upstream = await directusServerFetch(`/assets/${id}`);
	if (!upstream.ok || !upstream.body) throw error(502, 'Gagal memuat aset.');

	const headers = new Headers();
	headers.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
	const len = upstream.headers.get('content-length');
	if (len) headers.set('Content-Length', len);
	// Denah jarang berubah — boleh di-cache di terminal.
	headers.set('Cache-Control', 'private, max-age=3600');

	return new Response(upstream.body, { status: 200, headers });
};
