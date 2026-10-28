// src/routes/api/requisition/[id]/+server.ts
// Detail satu Requisition milik user yang login (untuk halaman status/timeline).

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { getRequisitionDetail } from '$lib/server/requisitionSubmit';

export async function GET(event: RequestEvent) {
	const fbUser = await requireUser(event);
	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId);
	if (!karyawan) {
		throw error(403, 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin untuk pemetaan identitas.');
	}

	const id = parseInt(event.params.id || '');
	if (!id) throw error(400, 'ID requisition tidak valid');

	const data = await getRequisitionDetail(id, karyawan.id);
	if (!data) throw error(404, 'Requisition tidak ditemukan');

	return json({ success: true, data });
}
