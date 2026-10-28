// src/routes/api/kiosk/ciketing-cek-stok/+server.ts
// Rute lama (kompatibel) — kini delegasi ke handler terpadu; versi berparameter: /api/kiosk/[workshop]/cek-stok.
import type { RequestHandler } from '@sveltejs/kit';
import { kioskCekStokGet } from '$lib/server/workshopKioskHandlers';

export const GET: RequestHandler = (event) => kioskCekStokGet(event, 'ciketing');
