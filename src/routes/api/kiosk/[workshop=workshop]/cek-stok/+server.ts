// src/routes/api/kiosk/[workshop=workshop]/cek-stok/+server.ts
// Cek stok read-only kiosk, Ciketing & Balaraja (Fase 7 Unifikasi Workshop). Logika: workshopKioskHandlers.ts.
import type { RequestHandler } from '@sveltejs/kit';
import { kioskCekStokGet } from '$lib/server/workshopKioskHandlers';
import type { WorkshopKey } from '$lib/kiosk/workshopKiosk';

export const GET: RequestHandler = (event) => kioskCekStokGet(event, event.params.workshop as WorkshopKey);
