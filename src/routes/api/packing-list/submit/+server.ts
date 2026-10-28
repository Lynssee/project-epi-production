// src/routes/api/packing-list/submit/+server.ts
// Submit pengajuan packing list dari dashboard lapangan dengan approval gate.
// requester_id diambil dari identitas Firebase yang login (bukan dari body)
// agar tidak bisa dipalsukan. Lihat src/lib/server/packingListSubmit.ts.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { submitPackingListRequest } from '$lib/server/packingListSubmit';
import { resolveFieldOverrideAllowed } from '$lib/server/gates/plFieldOverride';

export async function POST(event: RequestEvent) {
	const fbUser = await requireUser(event);

	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId);
	if (!karyawan) {
		throw error(403, 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin untuk pemetaan identitas.');
	}

	const body = await event.request.json().catch(() => ({}));
	const items = Array.isArray(body?.items) ? body.items : [];
	const overrideAllowed = await resolveFieldOverrideAllowed(event);

	try {
		const result = await submitPackingListRequest({
			requesterId: karyawan.id,
			departmentKey: karyawan.divisi,
			items,
			overrideAllowed,
			firebaseUid: fbUser.localId
		});
		return json({ success: true, data: result });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal mengajukan packing list');
	}
}

export async function GET() {
	throw error(405, 'Gunakan POST');
}
