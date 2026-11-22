// src/routes/api/kiosk/standby/+server.ts
// Konten slideshow standby layar Kiosk (Budaya & Propaganda Fase 5). Wajib sesi kiosk; hanya teks internal — tanpa data sensitif.
import { json, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { getStandby } from '$lib/server/kioskStandby';

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	return json(await getStandby(), { headers: { 'Cache-Control': 'private, max-age=60' } });
};
