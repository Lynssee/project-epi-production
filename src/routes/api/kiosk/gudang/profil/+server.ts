// src/routes/api/kiosk/gudang/profil/+server.ts
// Profil kiosk gudang (RM / FG / Central). GET ?gudang_id=<id> → profil + menu yang tampil,
// plus daftar gudang untuk memilih lokasi terminal. F4-C, Briefing Gate Dua Tingkat (21 Sep 2026).

import { json, type RequestHandler } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { listTerminalGudang, profilForGudang } from '$lib/server/kioskProfil';
import { menusForProfil } from '$lib/kiosk/profilGudang';

export const GET: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	const gudangId = Number(event.url.searchParams.get('gudang_id'));
	const [options, profil, karyawanRes] = await Promise.all([
		listTerminalGudang({ includeZona: true }),
		Number.isFinite(gudangId) && gudangId > 0 ? profilForGudang(gudangId) : Promise.resolve(null),
		// File 07 §2.4 — Menu Gudang perlu tahu kiosk_menu_access untuk menyaring tile,
		// bukan hanya profil lokasi (RM/FG/Central) yang sudah ada.
		directusServerJson<{ data: any[] }>(
			`/items/karyawan?filter[id][_eq]=${session.karyawanId}&fields=kiosk_menu_access&limit=1`
		).catch((e) => {
			console.error('[api/kiosk/gudang/profil] gagal baca kiosk_menu_access', e);
			return { data: [] };
		})
	]);
	const menuAccess = Array.isArray(karyawanRes?.data?.[0]?.kiosk_menu_access) ? karyawanRes.data[0].kiosk_menu_access : [];
	return json({ options, profil, menus: menusForProfil(profil), menuAccess });
};
