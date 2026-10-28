// src/lib/server/sjManualSubmit.ts
// Fase 3 (Penajaman Surat Jalan Manual): pengajuan SJ Manual dari lapangan.
// Ditulis langsung ke collection `surat_jalan` dengan type='manual' (penanda yang sama dipakai alur
// Urgent Dispatch admin) + item di surat_jalan_items — kolom is_manual/manual_*/delivery_items TIDAK ADA di
// skema live (lihat sjManualFields.ts), lalu mengajukan approval lewat
// Universal Approval Engine (module_key: logistik.surat_jalan_manual).
//
// SENGAJA TIDAK memotong stok di sini (beda dari alur admin "Urgent Dispatch" yang
// langsung potong stok saat create) — pemotongan stok dari lapangan butuh logika
// createStockOut() yang kompleks & belum diverifikasi aman direplikasi lintas-app.
// Gudang/Admin memproses potong stok saat SJ disetujui & barang benar disiapkan.

import { env } from '$env/dynamic/private';
import { directusServerJson } from './directus';
import { allocateSjManualNomor, generateSjManualQrToken } from './sjManualNumber';
import { createApprovalRequest } from './approvalSubmit';
import { notifySjManualSubmitted } from './sjManualNotify';
import { SJ_MANUAL_TYPE, composeManualNotes, toSuratJalanItemRows } from './sjManualFields';

// erp-epi-1 live di internal.eltamaprimaindo.com (pola sama dgn packingListSubmit.ts / requisitionSubmit.ts).
const ERP_EPI_1_ORIGIN = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');

export interface SjManualItemInput {
	itemId?: number | null;
	namaBarang: string;
	qty: number;
	satuan?: string;
	notes?: string;
}

export async function getSjManualConfig() {
	const res = await directusServerJson<{ data: any[] }>(
		`/items/konfigurasi_surat_jalan?sort=-berlaku_dari&limit=1&fields=sj_manual_enabled,require_scan_upload,rbac_role_pengaju_manual`
	);
	const row = res?.data?.[0];
	return {
		enabled: row?.sj_manual_enabled !== false,
		requireScanUpload: !!row?.require_scan_upload,
		allowedRoles: Array.isArray(row?.rbac_role_pengaju_manual) && row.rbac_role_pengaju_manual.length
			? row.rbac_role_pengaju_manual
			: null
	};
}

export function canSubmitSjManual(config: { allowedRoles: string[] | null }, jabatanLabel: string | null) {
	if (!config.allowedRoles) return true; // null = semua role boleh
	if (!jabatanLabel) return false;
	return config.allowedRoles.some((r) => r.toUpperCase() === jabatanLabel.toUpperCase());
}

/** Best-effort, sama pola dgn notifySjiSubmitted — kegagalan di sini tidak pernah membatalkan SJ yang sudah tersimpan. */
async function raiseApproval({
	sjId,
	nomor,
	notes,
	customerName,
	karyawanId,
	karyawanNama,
	karyawanDivisi
}: {
	sjId: number;
	nomor: string;
	notes?: string;
	customerName: string;
	karyawanId: number;
	karyawanNama: string;
	karyawanDivisi: string | null;
}) {
	try {
		const approvalReq = await createApprovalRequest({
			moduleKey: 'logistik.surat_jalan_manual',
			sourceCollection: 'surat_jalan',
			sourceId: sjId,
			title: `SJ Manual ${nomor}`,
			summary: notes || `Tujuan: ${customerName}`,
			requesterId: karyawanId,
			callbackUrl: `${ERP_EPI_1_ORIGIN}/api/sj-manual/approval-callback`,
			payload: { nomor_sj: nomor }
		});
		if (!approvalReq?.id) throw new Error('approval_requests tidak terbentuk');
	} catch (e: any) {
		console.warn('[sjManualSubmit] gagal mengajukan approval_requests (diabaikan):', e?.message || e);
	}

	// Fase 4 — best-effort, terpisah dari mirror approval_requests di atas: kegagalan
	// notifikasi WA tidak boleh ikut menggagalkan hal lain. Nonaktif default (lihat sjManualNotify.ts).
	notifySjManualSubmitted(karyawanNama, karyawanDivisi, nomor).catch(() => {});
}

export async function submitSjManual({
	karyawanId,
	karyawanNama,
	karyawanDivisi,
	customerName,
	customerAddress,
	customerPhone,
	projectId,
	driverName,
	notes,
	items,
	scanFileId,
	fotoFileId
}: {
	karyawanId: number;
	karyawanNama: string;
	karyawanDivisi: string | null;
	customerName: string;
	customerAddress: string;
	customerPhone?: string;
	projectId?: number | null;
	driverName?: string;
	notes?: string;
	items: SjManualItemInput[];
	scanFileId?: string | null;
	fotoFileId?: string | null;
}) {
	const { nomor } = await allocateSjManualNomor();
	const qrToken = generateSjManualQrToken();

	const created = await directusServerJson<{ data: any }>('/items/surat_jalan', {
		method: 'POST',
		body: JSON.stringify({
			nomor_sj: nomor,
			qr_token: qrToken,
			driver: driverName || null,
			status: 'created',
			type: SJ_MANUAL_TYPE,
			project_id: projectId || null,
			delivery_address: customerAddress,
			notes: composeManualNotes(customerName, customerPhone, notes),
			requested_by: karyawanId,
			dibuat_oleh_karyawan_id: karyawanId,
			approval_status: 'menunggu',
			scan_sj_file: scanFileId || null,
			foto_terima: fotoFileId || null
		})
	});
	const header = created?.data;
	if (!header?.id) throw new Error('Gagal membuat Surat Jalan Manual');

	// Item di surat_jalan_items. Gagal di sini TIDAK boleh meninggalkan SJ tanpa item: batalkan header agar tidak yatim.
	try {
		await directusServerJson('/items/surat_jalan_items', {
			method: 'POST',
			body: JSON.stringify(toSuratJalanItemRows(header.id, items))
		});
	} catch (e: any) {
		await directusServerJson(`/items/surat_jalan/${header.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ status: 'cancelled', approval_status: 'ditolak' })
		}).catch(() => {});
		throw new Error('Gagal menyimpan item Surat Jalan Manual: ' + (e?.message || e));
	}

	await raiseApproval({ sjId: header.id, nomor, notes, customerName, karyawanId, karyawanNama, karyawanDivisi });

	return { id: header.id, nomor_sj: nomor, qr_token: qrToken };
}

/**
 * Fase 3 lanjutan (revisi): SJ Manual yang ditolak (approval_status='ditolak') boleh
 * direvisi & diajukan ulang oleh pemohon aslinya. Menerbitkan approval_requests BARU
 * (bukan reuse baris lama yang sudah final) — konsisten dengan prinsip approvalEngine.js
 * bahwa satu baris approval_requests immutable setelah status final.
 */
export async function resubmitSjManual({
	sjId,
	karyawanId,
	karyawanNama,
	karyawanDivisi,
	customerName,
	customerAddress,
	customerPhone,
	projectId,
	driverName,
	notes,
	items,
	scanFileId,
	fotoFileId
}: {
	sjId: number;
	karyawanId: number;
	karyawanNama: string;
	karyawanDivisi: string | null;
	customerName: string;
	customerAddress: string;
	customerPhone?: string;
	projectId?: number | null;
	driverName?: string;
	notes?: string;
	items: SjManualItemInput[];
	scanFileId?: string | null;
	fotoFileId?: string | null;
}) {
	const existing = await directusServerJson<{ data: any }>(`/items/surat_jalan/${sjId}?fields=nomor_sj,requested_by,approval_status`);
	const sj = existing?.data;
	if (!sj || sj.requested_by !== karyawanId) throw new Error('SJ Manual tidak ditemukan');
	if (sj.approval_status !== 'ditolak') throw new Error('Hanya SJ Manual berstatus ditolak yang bisa direvisi');

	await directusServerJson(`/items/surat_jalan/${sjId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			driver: driverName || null,
			project_id: projectId || null,
			delivery_address: customerAddress,
			notes: composeManualNotes(customerName, customerPhone, notes),
			approval_status: 'menunggu',
			status: 'created',
			...(scanFileId ? { scan_sj_file: scanFileId } : {}),
			...(fotoFileId ? { foto_terima: fotoFileId } : {})
		})
	});

	// Ganti item lama dengan item hasil revisi (hapus lalu buat ulang).
	const oldItems = await directusServerJson<{ data: Array<{ id: number }> }>(
		`/items/surat_jalan_items?filter[surat_jalan_id][_eq]=${sjId}&fields=id&limit=-1`
	).catch(() => ({ data: [] as Array<{ id: number }> }));
	const oldIds = (oldItems?.data || []).map((r) => r.id);
	if (oldIds.length) {
		await directusServerJson('/items/surat_jalan_items', { method: 'DELETE', body: JSON.stringify(oldIds) });
	}
	await directusServerJson('/items/surat_jalan_items', {
		method: 'POST',
		body: JSON.stringify(toSuratJalanItemRows(sjId, items))
	});

	await raiseApproval({ sjId, nomor: sj.nomor_sj, notes, customerName, karyawanId, karyawanNama, karyawanDivisi });

	return { id: sjId, nomor_sj: sj.nomor_sj };
}
