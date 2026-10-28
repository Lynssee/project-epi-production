// src/routes/api/packing-list/objection/+server.ts
// SERVER-ONLY. Rencana v2 "Packing List -> Multi Surat Jalan + Pergantian Barang"
// (23 Sep 2026), Fase 3, alternatif #3 (mode SOFT): leader/pemohon bisa "Ajukan
// Keberatan" saat gudang mengganti barang di pengajuannya. Ini CATATAN, bukan gerbang
// approval -- tidak memblokir/menahan kiriman apa pun (Aturan Anti-Kesalahan #3/#6).
// Ditulis langsung ke approval_requests (project-epi & erp-epi-1 berbagi satu Directus
// instance, pola sama seperti packingListSubmit.ts) dengan status 'approved' -- ini
// jejak informasional (mirip packing_list.admin_edit/item_edit di erp-epi-1), BUKAN
// permintaan yang menunggu keputusan siapa pun, supaya tidak nyasar ke antrean approval
// generik. Admin melihatnya lewat kartu To-Do khusus (erp-epi-1
// InventoryAdminToDoCenter.svelte, sub-kategori "Keberatan Ganti Barang").

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';

export async function POST(event: RequestEvent) {
	const fbUser = await requireUser(event);
	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId);
	if (!karyawan) {
		throw error(403, 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin.');
	}

	const body = await event.request.json().catch(() => ({}));
	const budgetItemId = Number(body?.budget_item_id);
	const note = String(body?.note || '').trim();
	const before = body?.before || null;
	const after = body?.after || null;

	if (!Number.isInteger(budgetItemId) || budgetItemId <= 0) throw error(400, 'budget_item_id tidak valid.');
	if (note.length < 5) throw error(400, 'Tuliskan alasan keberatan (minimal 5 karakter).');

	try {
		const rec: any = await directusServerJson('/items/approval_requests', {
			method: 'POST',
			body: JSON.stringify({
				module_key: 'packing_list.keberatan_ganti_barang',
				source_collection: 'project_budgets',
				source_id: String(budgetItemId),
				title: `Keberatan ganti barang: ${before?.material_name || '-'} -> ${after?.material_name || '-'}`,
				summary: `${karyawan.nama_karyawan || fbUser.email}: ${note}`,
				department_key: karyawan.divisi || 'PROJECT',
				requester_id: karyawan.id,
				current_step: 1,
				status: 'approved', // jejak informasional, bukan permintaan yang menunggu keputusan
				payload: {
					kind: 'keberatan_ganti_barang',
					budget_item_id: budgetItemId,
					before,
					after,
					note,
					submitted_by: karyawan.id,
					submitted_at: new Date().toISOString()
				}
			})
		});
		return json({ success: true, id: rec?.data?.id || null });
	} catch (e: any) {
		throw error(502, `Gagal menyimpan keberatan: ${e?.message || ''}`);
	}
}

export async function GET() {
	throw error(405, 'Gunakan POST');
}
