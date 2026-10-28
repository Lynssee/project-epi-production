// src/routes/api/retur-gudang/+server.ts
// 4-Gate System "Surat Jalan Pengembalian & Kontrol Aset Proyek" — Rencana v2, Fase 2.3.
// Leader lapangan membungkus baris packing_returns yang baru diajukan jadi SATU dokumen
// retur (retur_gudang) yang bisa dicetak & dipindai satpam/gudang.
//
// Identitas + kepemilikan proyek DIVALIDASI di sini (authenticateProjectLeader) — projectId
// dari body tidak dipercaya mentah, harus proyek yang benar-benar dipimpin pemanggil.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { authenticateProjectLeader } from '$lib/server/projectLeaderGuard';
import { requireUser } from '$lib/server/firebaseAuth';
import { createReturDocument, getReturDocument } from '$lib/server/returGudangServer';
import { getInventorySettingServer } from '$lib/server/inventorySettings';
import { submitReturPengajuan, ReturSubmitError, type SubmitReturItem } from '$lib/server/returSubmit';

// Penerbit surat jalan retur proyek. Default 'inventory': leader hanya mengajukan, tim Inventory
// yang menerbitkan surat jalan pengambilan dari dashboard admin. Server yang memutuskan — klien
// versi lama yang masih memanggil endpoint ini tidak bisa lagi menerbitkan dokumen "dikirim".
const PENERBIT_KEY = 'inventory.retur.penerbit_surat_jalan';

export async function POST(event: RequestEvent) {
	const body = await event.request.json().catch(() => ({}));
	const projectId = Number(body?.projectId);
	if (!Number.isFinite(projectId) || projectId <= 0) {
		throw error(400, 'projectId wajib diisi');
	}

	// Auth + validasi: pemanggil memimpin proyek ini.
	const { karyawan } = await authenticateProjectLeader(event, projectId);
	const fbUser = await requireUser(event);

	const packingReturnIds = Array.isArray(body?.packingReturnIds)
		? body.packingReturnIds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
		: [];
	// §7 rekomendasi L4 — alat (internal_loan_log, PK uuid) yang ikut dokumen retur ini.
	const equipmentLoanIds = Array.isArray(body?.equipmentLoanIds)
		? body.equipmentLoanIds.map(String).filter(Boolean)
		: [];
	const sumber = body?.sumber === 'karantina' ? 'karantina' : 'lapangan';

	// RSM-02/03 — alur BARU satu request: klien mengirim `items` (bukan id baris yang sudah dibuat sendiri).
	// Server membuat baris + header sekaligus, idempoten lewat clientSubmissionId, dengan gate G_RTN_DOBEL.
	if (Array.isArray(body?.items)) {
		const penerbitNew = (await getInventorySettingServer<string>(PENERBIT_KEY, 'inventory')) === 'lapangan' ? 'lapangan' : 'inventory';
		const items: SubmitReturItem[] = body.items.map((i: any) => ({
			material_name: String(i?.material_name || '').trim(),
			material_color: i?.material_color ? String(i.material_color) : null,
			qty_returned: Number(i?.qty_returned),
			unit: String(i?.unit || '').trim(),
			condition: String(i?.condition || 'ok'),
			leader_notes: i?.leader_notes ? String(i.leader_notes) : null,
			item_id: i?.item_id != null ? Number(i.item_id) || null : null,
			packing_list_id: i?.packing_list_id != null ? Number(i.packing_list_id) || null : null,
			packing_list_item_id: i?.packing_list_item_id != null ? Number(i.packing_list_item_id) || null : null
		}));
		const bad = items.find((i) => !i.material_name || !Number.isFinite(i.qty_returned) || i.qty_returned <= 0 || !i.unit);
		if (bad || (items.length === 0 && equipmentLoanIds.length === 0)) {
			throw error(400, 'Setiap barang wajib punya nama, qty > 0, dan satuan (minimal satu barang atau alat).');
		}
		try {
			const r = await submitReturPengajuan({
				projectId,
				items,
				equipmentLoanIds,
				submittedByName: karyawan.nama_karyawan || 'Leader',
				submittedByKaryawanId: karyawan.id,
				submittedByUid: fbUser.localId,
				email: fbUser.email || null,
				clientSubmissionId: body?.clientSubmissionId ? String(body.clientSubmissionId) : null,
				overrideReason: body?.overrideReason ? String(body.overrideReason) : null,
				penerbit: penerbitNew,
				sumber,
				driverName: body?.driverName || null,
				driverPhone: body?.driverPhone || null,
				vehiclePlate: body?.vehiclePlate || null,
				expeditionName: body?.expeditionName || null,
				notes: body?.notes || null
			});
			return json({ success: true, data: r.doc, rowIds: r.rowIds, idempotent: r.idempotent, penerbit: penerbitNew });
		} catch (e: any) {
			if (e instanceof ReturSubmitError) {
				return json({ success: false, code: e.code, message: e.message, dobel: e.dobel ?? null }, { status: e.status });
			}
			throw error(500, e?.message || 'Gagal memproses pengajuan retur');
		}
	}

	if (sumber !== 'karantina' && packingReturnIds.length === 0 && equipmentLoanIds.length === 0) {
		throw error(400, 'packingReturnIds atau equipmentLoanIds wajib diisi (minimal satu baris retur/alat)');
	}

	const penerbitRaw = await getInventorySettingServer<string>(PENERBIT_KEY, 'inventory');
	const penerbit = penerbitRaw === 'lapangan' ? 'lapangan' : 'inventory';
	const olehInventory = penerbit === 'inventory' && sumber !== 'karantina';

	// RSM-02 §4.1: header SELALU dibuat (dulu pengajuan barang saja tidak dapat dokumen -> leader tanpa
	// nomor). Penerbit 'inventory' membuatnya sebagai 'draft'; sopir/jadwal dilengkapi Inventory.
	try {
		const result = await createReturDocument({
			projectId,
			packingReturnIds,
			equipmentLoanIds,
			submittedByKaryawanId: karyawan.id,
			submittedByUid: fbUser.localId,
			// Mode Inventory + ada alat: dokumen tetap dibuat karena pengembalian alat HANYA tercatat
			// lewat tautan internal_loan_log.retur_gudang_id — tapi sebagai 'draft' (menunggu dijemput)
			// tanpa data sopir; sopir/kendaraan/tanggal dilengkapi Inventory di halaman cetaknya.
			driverName: olehInventory ? null : body?.driverName || null,
			driverPhone: olehInventory ? null : body?.driverPhone || null,
			vehiclePlate: olehInventory ? null : body?.vehiclePlate || null,
			expeditionName: olehInventory ? null : body?.expeditionName || null,
			notes: body?.notes || null,
			sumber,
			status: olehInventory ? 'draft' : 'dikirim'
		});
		return json({ success: true, data: result, penerbit });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal membuat dokumen retur');
	}
}

// GET ?id= — data dokumen retur untuk halaman cetak. Auth: leader proyek pemilik dokumen.
export async function GET(event: RequestEvent) {
	const id = Number(event.url.searchParams.get('id'));
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'Parameter id wajib diisi');

	// Ambil dulu (butuh project_id-nya untuk validasi kepemilikan).
	const doc = await getReturDocument(id);
	if (!doc) throw error(404, 'Dokumen retur tidak ditemukan');
	await authenticateProjectLeader(event, Number(doc.project_id));

	return json({ success: true, data: doc });
}
