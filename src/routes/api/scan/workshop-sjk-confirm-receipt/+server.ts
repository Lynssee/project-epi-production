// src/routes/api/scan/workshop-sjk-confirm-receipt/+server.ts
// Konfirmasi terima SJ Keluar Workshop via scan QR — terpadu Ciketing & Balaraja (Fase 7 Unifikasi Workshop).
// Body: { workshopKey: 'ciketing' | 'balaraja', sjkId, receiverName, fotoFileId?, clientEventId? }. Logika: workshopSjkReceipt.ts.
import type { RequestEvent } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { confirmWorkshopSjkReceipt } from '$lib/server/workshopSjkReceipt';

export async function POST(event: RequestEvent) {
	// Body hanya bisa dibaca sekali → klon permintaan untuk membaca workshopKey, handler membaca aslinya.
	const peek = await event.request.clone().json().catch(() => null);
	if (!peek?.workshopKey) throw error(400, 'workshopKey wajib diisi.');
	return confirmWorkshopSjkReceipt(event, peek.workshopKey);
}
