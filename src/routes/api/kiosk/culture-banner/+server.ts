// src/routes/api/kiosk/culture-banner/+server.ts
// Motto & pesan budaya hari ini untuk layar Kiosk Produksi (Budaya & Propaganda Fase 2).
// Wajib sesi kiosk; hanya mengembalikan teks publik-internal (tanpa data karyawan). Konten ter-cache 60 dtk di server.
import { json, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { getKioskBanner } from '$lib/server/ess/budayaHarian';

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	const banner = await getKioskBanner();
	return json({ banner }, { headers: { 'Cache-Control': 'private, max-age=60' } });
};
