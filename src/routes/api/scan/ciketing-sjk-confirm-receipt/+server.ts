// src/routes/api/scan/ciketing-sjk-confirm-receipt/+server.ts
// Rute lama (kompatibel, klien/PWA lama) — delegasi ke handler terpadu dengan workshop 'ciketing'.
// Versi berparameter: /api/scan/workshop-sjk-confirm-receipt (R7 24 Sep 2026; Fase 7 Unifikasi Workshop).
import type { RequestEvent } from '@sveltejs/kit';
import { confirmWorkshopSjkReceipt } from '$lib/server/workshopSjkReceipt';

export async function POST(event: RequestEvent) {
	return confirmWorkshopSjkReceipt(event, 'ciketing');
}
