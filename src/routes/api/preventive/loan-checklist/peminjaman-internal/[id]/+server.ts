// src/routes/api/preventive/loan-checklist/peminjaman-internal/[id]/+server.ts
// Fase 3 (port BR-01 -> peminjaman_internal, 15 Sep 2026) — detail satu peminjaman untuk
// layar pengisian checklist harian (server-side, sama alasan dgn +server.ts sebelahnya).
// Ownership diverifikasi lewat authenticateLoanOwner (loan diambil ulang by ID, bukan
// percaya klien).
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateLoanOwner, resolveEquipmentFromItemServer } from '$lib/server/preventive/loanGuard';
import { directusServerJson } from '$lib/server/directus';

export const GET: RequestHandler = async (event) => {
	const id = event.params.id;
	if (!id) throw error(400, 'id wajib diisi.');

	const { loan } = await authenticateLoanOwner(event, id, 'peminjaman_internal');

	// authenticateLoanOwner cuma mengembalikan equipment_id (string) — ambil detail
	// item_id lagi untuk resolve nama/kode equipment (dipisah per Aturan Directus #2).
	const piRes = await directusServerJson<{ data: { item_id: number } }>(`/items/peminjaman_internal/${id}?fields=item_id`);
	const equipment = await resolveEquipmentFromItemServer(piRes?.data?.item_id);
	if (!equipment) throw error(404, 'Unit equipment untuk peminjaman ini tidak ditemukan.');

	return json({
		data: {
			id: loan.id,
			equipment_id: equipment.id,
			equipment: { id: equipment.id, name: equipment.name, code: equipment.code },
			status: loan.status
		}
	});
};
