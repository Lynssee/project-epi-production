// src/routes/api/gates/fix/usul-tautan-barang/+server.ts
// Gate Transparan & Popup Benahi Data, Fase 3 — aksi "Benahi Inline" C (usul tautan barang).
//
// Leader mengusulkan barang master untuk baris project_budgets yang belum tertaut
// identitas_barang_id. TIDAK menulis project_budgets.identitas_barang_id langsung --
// salah tautan = salah potong stok gudang saat SJ terbit, tidak bisa dibatalkan bersih.
// Usulan disimpan di `identitas_barang_usulan` (status='menunggu'); Admin Logistik yang
// mengonfirmasi/tolak lewat kotak masuk di erp-epi-1 (B1, belum dibangun -- di luar
// scope Fase 3 project-epi).

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { authenticateProjectLeaderForBudgetItem } from '$lib/server/projectLeaderGuard';
import { directusServerJson } from '$lib/server/directus';

export async function POST(event: RequestEvent) {
	const body = await event.request.json().catch(() => ({}));
	const projectBudgetId = Number(body.projectBudgetId);
	const usulanIdentitasBarangId = Number(body.usulanIdentitasBarangId);
	const catatan = body.catatan ? String(body.catatan).trim().slice(0, 1000) : null;

	if (!projectBudgetId) throw error(400, 'projectBudgetId wajib.');
	if (!usulanIdentitasBarangId) throw error(400, 'usulanIdentitasBarangId wajib (pilih barang dari daftar pencarian).');

	const { karyawan } = await authenticateProjectLeaderForBudgetItem(event, projectBudgetId);

	// Satu baris RAB cuma boleh punya satu usulan menunggu aktif -- kalau leader
	// mengusulkan ulang, timpa usulan lama (bukan menumpuk duplikat di kotak masuk admin).
	const existing = await directusServerJson<{ data: Array<{ id: number }> }>(
		`/items/identitas_barang_usulan?filter[project_budget_id][_eq]=${projectBudgetId}&filter[status][_eq]=menunggu&fields=id&limit=1`
	).catch(() => null);

	let usulanId: number | null = null;
	if (existing?.data?.[0]) {
		await directusServerJson(`/items/identitas_barang_usulan/${existing.data[0].id}`, {
			method: 'PATCH',
			body: JSON.stringify({ usulan_identitas_barang_id: usulanIdentitasBarangId, catatan })
		});
		usulanId = existing.data[0].id;
	} else {
		const created = await directusServerJson<{ data: { id: number } }>('/items/identitas_barang_usulan', {
			method: 'POST',
			body: JSON.stringify({
				project_budget_id: projectBudgetId,
				usulan_identitas_barang_id: usulanIdentitasBarangId,
				catatan,
				status: 'menunggu',
				diusulkan_oleh_karyawan_id: karyawan.id
			})
		});
		usulanId = created?.data?.id ?? null;
	}

	return json({ ok: true, usulanId, note: 'Usulan terkirim. Admin Logistik akan mengonfirmasi tautan ini.' });
}
