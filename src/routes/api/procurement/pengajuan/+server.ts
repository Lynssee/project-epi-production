// src/routes/api/procurement/pengajuan/+server.ts
// Submit Permintaan Pembelian (PR) baru dari dashboard lapangan. requesterId
// selalu server-derived dari identitas Firebase yang login (sama pola dengan
// api/requisition/+server.ts).

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { createPengajuanLapangan } from '$lib/server/procurementSubmit';
import { authorizeAtasNama } from '$lib/server/pengajuanAtasNama';
import { notifyPemohonViaAdmin } from '$lib/server/atasNamaNotify';
import { reportInventorySpecShadow } from '$lib/server/inventorySpecShadow';

export async function POST(event: RequestEvent) {
	const fbUser = await requireUser(event);
	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId);

	const body = await event.request.json().catch(() => ({}));
	const {
		namaPengaju,
		department,
		urgency,
		tujuanPengajuan,
		tanggalDibutuhkan,
		isNonStock,
		items,
		clientTxnId,
		kategoriPembelian,
		projectId,
		customFieldsData,
		workOrderId,
		areaId,
		workshopId,
		atasNama // { pemohonKaryawanId, alasan } — Pengajuan Darurat Atas Nama
	} = body;

	if (!namaPengaju || !department || !tujuanPengajuan) {
		throw error(400, 'Nama pengaju, departemen, dan tujuan pengajuan wajib diisi');
	}
	if (!Array.isArray(items) || items.length === 0) {
		throw error(400, 'Minimal 1 item diperlukan');
	}

	// Atas Nama: otorisasi SERVER (Leader/Wakil proyek ini, atau Supervisor berizin; pemohon anggota aktif proyek).
	// Pemohon & namanya diambil dari data server, bukan dari klien.
	let atasNamaCtx: { pengisiKaryawanId: number; alasan: string } | null = null;
	let pemohon: { karyawanId: number; nama: string } | null = null;
	if (atasNama) {
		const alasan = String(atasNama.alasan || '').trim();
		if (alasan.length < 10) throw error(400, 'Isi alasan kebutuhan darurat (minimal 10 karakter).');
		const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
		const auth = await authorizeAtasNama({
			idToken,
			uid: (fbUser as any).uid || fbUser.localId,
			email: fbUser.email,
			projectId: Number(projectId),
			pemohonKaryawanId: Number(atasNama.pemohonKaryawanId)
		});
		if (!auth.ok) throw error((auth as any).httpStatus || 403, (auth as any).message || 'Tidak berwenang mengajukan atas nama.');
		pemohon = { karyawanId: auth.pemohon!.karyawanId, nama: auth.pemohon!.nama };
		atasNamaCtx = { pengisiKaryawanId: auth.pengisi!.id, alasan };
	}

	try {
		const result = await createPengajuanLapangan({
			requesterId: pemohon ? pemohon.karyawanId : karyawan?.id || null,
			atasNama: atasNamaCtx,
			namaPengaju: pemohon ? pemohon.nama : namaPengaju,
			department,
			urgency,
			tujuanPengajuan,
			tanggalDibutuhkan,
			isNonStock: !!isNonStock,
			items,
			clientTxnId: clientTxnId || null,
			kategoriPembelian: kategoriPembelian || null,
			projectId: projectId || null,
			customFieldsData: customFieldsData || null,
			workOrderId: workOrderId || null,
			areaId: areaId || null,
			workshopId: workshopId || null
		});
		// Atas Nama: beri tahu pemohon lewat admin (WA dari master karyawan + in-app). Best-effort.
		if (atasNamaCtx && !result.reused) await notifyPemohonViaAdmin(event, 'pr', result.id);
		// Inventory 360° — gate G_INV_SPEC_PURCHASE mode SHADOW (hanya dicatat di erp-epi, tidak menahan PR).
		if (!result.reused) {
			reportInventorySpecShadow({
				kind: 'purchase',
				collection: 'items/pengajuan',
				recordId: result.id,
				itemIds: (items as any[]).map((it) => it?.identitas_barang_id),
				userEmail: fbUser.email
			});
		}
		return json({ success: true, id: result.id });
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal mengajukan pembelian');
	}
}
