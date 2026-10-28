// src/routes/api/kiosk/[workshop=workshop]/potong-bahan/+server.ts
// Potong bahan via scan QR, Ciketing & Balaraja (Fase 7 Unifikasi Workshop). Logika: workshopKioskHandlers.ts.
import type { RequestHandler } from '@sveltejs/kit';
import { kioskPotongBahanGet, kioskPotongBahanPost } from '$lib/server/workshopKioskHandlers';
import type { WorkshopKey } from '$lib/kiosk/workshopKiosk';

export const GET: RequestHandler = (event) => kioskPotongBahanGet(event, event.params.workshop as WorkshopKey);
export const POST: RequestHandler = (event) => kioskPotongBahanPost(event, event.params.workshop as WorkshopKey);
