// src/routes/api/kiosk/ciketing-potong-bahan/+server.ts
// Rute lama (kompatibel) — kini delegasi ke handler terpadu; versi berparameter: /api/kiosk/[workshop]/potong-bahan.
// Potong bahan Ciketing tetap lewat ciketingKioskStock.ts (CAS saldo + kompensasi ledger), tidak diubah.
import type { RequestHandler } from '@sveltejs/kit';
import { kioskPotongBahanGet, kioskPotongBahanPost } from '$lib/server/workshopKioskHandlers';

export const GET: RequestHandler = (event) => kioskPotongBahanGet(event, 'ciketing');
export const POST: RequestHandler = (event) => kioskPotongBahanPost(event, 'ciketing');
