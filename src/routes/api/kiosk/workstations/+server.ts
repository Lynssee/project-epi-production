// src/routes/api/kiosk/workstations/+server.ts
// Rencana Absensi Istirahat v2, Fase 1 — daftar master_workstation tipe kiosk_produksi aktif,
// dipakai kiosk untuk memilih "kiosk ini di mana" satu kali saat setup perangkat (tersimpan
// localStorage, bukan per-sesi login, karena satu device fisik tidak berpindah lokasi).

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { directusServerJson } from '$lib/server/directus';

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	const res = await directusServerJson<{ data: any[] }>(
		`/items/master_workstation?filter[tipe][_eq]=kiosk_produksi&filter[aktif][_eq]=true&fields=id,kode,nama&sort=kode&limit=-1`
	);
	return json({ workstations: res?.data || [] });
};
