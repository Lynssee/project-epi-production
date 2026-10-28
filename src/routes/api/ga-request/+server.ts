// src/routes/api/ga-request/+server.ts
// Submit GA Service Request baru dari dashboard lapangan. requesterId/divisi
// selalu server-derived dari identitas Firebase yang login (tidak dipercaya dari klien).

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { createGaFieldRequest, listMyGaRequests, cancelMyGaRequest } from '$lib/server/gaRequestSubmit';

export async function POST(event: RequestEvent) {
	const fbUser = await requireUser(event);

	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId);
	if (!karyawan) {
		throw error(403, 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin untuk pemetaan identitas.');
	}

	const body = await event.request.json().catch(() => ({}));
	const { jenis, deskripsi, lokasi, prioritas, tanggalBooking, jamMulai, jamSelesai } = body;

	try {
		const result = await createGaFieldRequest({
			requesterId: karyawan.id,
			requesterName: karyawan.nama_karyawan,
			divisi: karyawan.divisi,
			jenis,
			deskripsi,
			lokasi,
			prioritas,
			tanggalBooking,
			jamMulai,
			jamSelesai
		});
		return json({ success: true, data: result });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal membuat permintaan GA');
	}
}

/** GET: daftar "Permintaan Saya" (GA Service Request) milik user yang login. */
export async function GET(event: RequestEvent) {
	const fbUser = await requireUser(event);
	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId);
	if (!karyawan) {
		throw error(403, 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin untuk pemetaan identitas.');
	}
	const data = await listMyGaRequests(karyawan.id);
	return json({ success: true, data });
}

/** DELETE: batalkan permintaan GA milik user jika masih status 'baru'. */
export async function DELETE(event: RequestEvent) {
	const fbUser = await requireUser(event);
	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId);
	if (!karyawan) {
		throw error(403, 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin untuk pemetaan identitas.');
	}

	const idParam = event.url.searchParams.get('id');
	const id = idParam ? parseInt(idParam, 10) : 0;
	if (!id) {
		throw error(400, 'Parameter ID permintaan wajib disertakan');
	}

	try {
		const result = await cancelMyGaRequest(id, karyawan.id);
		return json({ success: true, data: result });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal membatalkan permintaan GA');
	}
}

