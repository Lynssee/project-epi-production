// src/routes/api/sales/visit/submit-by-txn/+server.ts
// Paket 08c Site Visit Release §5.3 — selesaikan kunjungan sales saat visitId BELUM diketahui
// klien (kunjungan dimulai OFFLINE lewat antrean /sales/baru — checkInVisit() sendiri belum
// tentu sudah tersinkron ke server). Klien hanya punya checkin_client_txn_id (dibuat sendiri
// saat check-in offline mulai ditulis ke antrean, lihat offlineSiteCheckinQueue.ts).
//
// Dipakai HANYA oleh siteCheckinSync.ts (replay dari antrean), bukan submit normal /sales/[id]
// (yang sudah tahu visitId, lewat /api/sales/visit/[id]/submit — logika sama,
// $lib/server/visitSalesSubmit.ts).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { submitVisitSalesCore } from '$lib/server/visitSalesSubmit';

export const POST: RequestHandler = async (event) => {
	const { karyawan, user } = await authenticateEss(event);
	const form = await event.request.formData();

	const checkinClientTxnId = form.get('checkin_client_txn_id')?.toString() || null;
	if (!checkinClientTxnId) throw error(400, 'checkin_client_txn_id wajib diisi.');

	// Resolve checkin_client_txn_id -> visit_sales_id. Belum ketemu = check-in itu sendiri BELUM
	// tersinkron (masih di antrean klien, atau baru saja dikirim di flush yang sama) — 425 (Too
	// Early) adalah status RETRYABLE (lihat networkError.ts:isRetryableError), jadi entri submit
	// ini tetap di antrean dan dicoba lagi flush berikutnya. Urutan createdAt (factory
	// ordered:true) menjamin check-in SELALU dicoba sebelum submit offline pasangannya.
	const checkinRes = await directusServerJson<{ data: { id: string; visit_sales_id: number | null }[] }>(
		`/items/site_checkin?filter[client_txn_id][_eq]=${encodeURIComponent(checkinClientTxnId)}&fields=id,visit_sales_id&limit=1`
	).catch(() => null);
	const checkin = checkinRes?.data?.[0];
	if (!checkin || !checkin.visit_sales_id) {
		throw error(425, 'Kunjungan ini belum tersinkron ke server. Akan dicoba lagi otomatis.');
	}

	return submitVisitSalesCore(form, event.request.headers.get('authorization') || '', checkin.visit_sales_id, karyawan, user.localId);
};
