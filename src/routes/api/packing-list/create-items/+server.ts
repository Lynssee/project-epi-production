// src/routes/api/packing-list/create-items/+server.ts
// Path A — Audit & Hardening Gate v2 (30 Agu 2026), F0.
// Jalur server-side untuk item packing list BARU / dari TEMPLATE (menggantikan
// penulisan project_budgets langsung dari klien). requester diambil dari identitas
// Firebase, bukan body. Lihat $lib/server/packingListCreateItems.ts.
//
//   POST { projectId, projectName?, items: [{ material_name, qty, unit, budget_category?,
//          material_color?, description?, identitas_barang_id? }] }

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { createPackingItemsRequest } from '$lib/server/packingListCreateItems';
import { resolveFieldOverrideAllowed } from '$lib/server/gates/plFieldOverride';

export async function POST(event: RequestEvent) {
	const fbUser = await requireUser(event);
	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId);
	if (!karyawan) {
		throw error(403, 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin untuk pemetaan identitas.');
	}

	const body = await event.request.json().catch(() => ({}) as any);
	const overrideAllowed = await resolveFieldOverrideAllowed(event);

	const rawItems = Array.isArray(body?.items) ? body.items : [];
	const unmapped = rawItems.filter(
		(it: any) => !it.identitas_barang_id && it.budget_category !== 'jasa' && it.budget_category !== 'lain_lain'
	);
	if (unmapped.length > 0) {
		const names = unmapped.map((it: any) => `"${it.material_name || it.description || 'Item'}"`).join(', ');
		throw error(400, `[G_PKL_INVENTORY_LINK] Seluruh item Packing List wajib dipilih dari Master Barang (identitas_barang). Ditemukan item tanpa Master SKU: ${names}. Silakan pilih item dari katalog master.`);
	}

	try {
		const result = await createPackingItemsRequest({
			projectId: Number(body?.projectId),
			requesterId: karyawan.id,
			pic: body?.pic || karyawan.nama_karyawan || 'Leader',
			departmentKey: karyawan.divisi,
			items: rawItems,
			projectName: body?.projectName || null,
			overrideAllowed,
			firebaseUid: fbUser.localId
		});
		return json({ success: true, data: result });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal membuat item packing list');
	}
}

export async function GET() {
	throw error(405, 'Gunakan POST');
}
