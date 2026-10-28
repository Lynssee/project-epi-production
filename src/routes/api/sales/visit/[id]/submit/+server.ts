// src/routes/api/sales/visit/[id]/submit/+server.ts
// Paket 08b Site Visit Release §4.2 — selesaikan kunjungan sales (jalur A, /sales/[id]),
// menggantikan services/sales.ts:submitVisit (menulis visit_sales langsung dari browser tanpa
// cek kepemilikan, dan diam-diam melanjutkan tanpa foto bila upload gagal — SVR-38).
//
// Paket 08c §5.3 — logika inti diekstrak ke $lib/server/visitSalesSubmit.ts (dipakai bersama
// dengan /api/sales/visit/submit-by-txn, jalur offline tanpa visitId diketahui di URL).

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { submitVisitSalesCore } from '$lib/server/visitSalesSubmit';

export const POST: RequestHandler = async (event) => {
	const { karyawan, user } = await authenticateEss(event);
	const visitId = Number(event.params.id);
	if (!Number.isFinite(visitId) || visitId <= 0) throw error(400, 'ID kunjungan tidak valid.');
	const form = await event.request.formData();
	return submitVisitSalesCore(form, event.request.headers.get('authorization') || '', visitId, karyawan, user.localId);
};
