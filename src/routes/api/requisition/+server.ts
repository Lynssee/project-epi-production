// src/routes/api/requisition/+server.ts
// Submit Requisition baru dari dashboard lapangan. requesterId/departmentKey
// selalu server-derived dari identitas Firebase yang login.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { createRequisition, listMyRequisitions } from '$lib/server/requisitionSubmit';
import { reportInventorySpecShadow } from '$lib/server/inventorySpecShadow';

export async function POST(event: RequestEvent) {
	const fbUser = await requireUser(event);

	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId);
	if (!karyawan) {
		throw error(403, 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin untuk pemetaan identitas.');
	}

	const body = await event.request.json().catch(() => ({}));
	const {
		departmentId,
		requisitionType,
		projectId,
		spkId,
		tujuanPenggunaan,
		tanggalDibutuhkan,
		destinationPicName,
		destinationAddress,
		accountCode,
		urgent,
		urgentReason,
		items
	} = body;

	try {
		const result = await createRequisition({
			requesterId: karyawan.id,
			departmentId,
			departmentKey: karyawan.divisi,
			requisitionType,
			projectId,
			spkId,
			tujuanPenggunaan,
			tanggalDibutuhkan,
			destinationPicName,
			destinationAddress,
			accountCode,
			urgent: !!urgent,
			urgentReason: urgentReason || null,
			items
		});
		// Inventory 360° — gate G_INV_TRAINING_KRITIS mode SHADOW (hanya dicatat di erp-epi, tidak menahan permintaan).
		reportInventorySpecShadow({
			kind: 'training',
			collection: 'items/requisition',
			recordId: (result as any)?.id ?? (result as any)?.requisitionId ?? '',
			itemIds: ((items as any[]) || []).map((it) => it?.identitas_barang_id),
			userEmail: fbUser.email,
			karyawanId: karyawan.id
		});
		return json({ success: true, data: result });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal membuat requisition');
	}
}

/** GET: daftar "Pengajuan Saya" milik user yang login. */
export async function GET(event: RequestEvent) {
	const fbUser = await requireUser(event);
	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId);
	if (!karyawan) {
		throw error(403, 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin untuk pemetaan identitas.');
	}
	const data = await listMyRequisitions(karyawan.id);
	return json({ success: true, data });
}
