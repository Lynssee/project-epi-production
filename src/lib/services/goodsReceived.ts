// src/lib/services/goodsReceived.ts
// Klien untuk alur Goods Received (GR) — konfirmasi penerimaan Surat Jalan
// material proyek dari ERP. Bagian dari Integrasi Logistik & Cost Actual Proyek.

import { getIdToken } from './secureDirectus';
import type { GRCondition } from '$lib/constants/grCondition';

export interface GRItem {
	itemType: 'rab' | 'generic';
	projectExpenseId?: number;
	suratJalanItemId?: number;
	materialName: string;
	unit: string;
	unitPrice: number;
	qtySent: number;
	expenseType: string | null;
	identitasBarangId: number | null;
}

export interface GRShipment {
	suratJalanId: number;
	nomorSJ: string;
	driver: string | null;
	tanggalKirim: string;
	qrToken: string | null;
	projectId: number | null;
	projectName: string;
	items: GRItem[];
}

export interface GREvidence {
	scanSjFileId?: string | null;
	ttdPenerimaFileId?: string | null;
	ttdDriverFileId?: string | null;
	evidencePhotoIds?: string[];
	gps?: { lat: number; lng: number; accuracy: number } | null;
}

async function authedFetch(path: string, options: RequestInit = {}): Promise<Response> {
	const token = await getIdToken();
	const { headers = {}, ...rest } = options;
	return fetch(path, {
		...rest,
		headers: {
			'Content-Type': 'application/json',
			...(headers as Record<string, string>),
			Authorization: `Bearer ${token}`
		}
	});
}

/** Daftar Surat Jalan material proyek yang masih 'Barang Dalam Perjalanan' untuk proyek leader yang login. */
export async function fetchInTransitShipments(): Promise<GRShipment[]> {
	const res = await authedFetch('/api/goods-received/list');
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err?.message || 'Gagal mengambil daftar Surat Jalan.');
	}
	const data = await res.json();
	return data.shipments || [];
}

export interface ConfirmGRItem {
	project_expense_id?: number;
	surat_jalan_item_id?: number; // Jalur GR generik non-RAB (B9/K17) — hanya Admin (lihat guard.ts)
	qty_received: number;
	condition?: GRCondition;
}

/** Konfirmasi penerimaan satu Surat Jalan — commit HPP + selisih/klaim sekaligus. */
export async function confirmGoodsReceived(
	suratJalanId: number,
	items: ConfirmGRItem[],
	fotoTerimaFileId: string,
	evidence: GREvidence = {}
): Promise<{ success: boolean; hasVariance: boolean; claimsCreated: number[]; totalReklas: number }> {
	const res = await authedFetch('/api/goods-received/confirm', {
		method: 'POST',
		body: JSON.stringify({ suratJalanId, items, fotoTerimaFileId, ...evidence })
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err?.message || 'Gagal mengonfirmasi penerimaan barang.');
	}
	return res.json();
}

export interface CekCatRow {
	project_expense_id?: number | null;
	surat_jalan_item_id?: number | null;
	nama_barang: string;
	segel_utuh: boolean;
	tidak_bocor_karat: boolean;
	homogen_diaduk: boolean;
	catatan?: string | null;
}

/**
 * Catat checklist visual kondisi cat (Fase 4 QC Re-test). Best-effort: TIDAK melempar error, supaya
 * kegagalan checklist tidak pernah membatalkan konfirmasi GR yang sudah sukses. Mengembalikan jumlah
 * baris bermasalah (ada centang kosong) atau null bila gagal simpan.
 */
export async function submitCekKondisiCat(suratJalanId: number, rows: CekCatRow[]): Promise<{ saved: number; bermasalah: number } | null> {
	if (!rows.length) return { saved: 0, bermasalah: 0 };
	try {
		const res = await authedFetch('/api/goods-received/cek-cat', {
			method: 'POST',
			body: JSON.stringify({ suratJalanId, rows })
		});
		if (!res.ok) {
			console.error('[submitCekKondisiCat] gagal simpan checklist cat:', res.status);
			return null;
		}
		return res.json();
	} catch (e) {
		console.error('[submitCekKondisiCat] gagal simpan checklist cat:', e);
		return null;
	}
}

export interface ReceivedSJ {
	id: number;
	nomor_sj: string;
	driver: string | null;
	received_at: string | null;
	status: string;
}

/** Cari Surat Jalan yang sudah diterima, untuk target komplain manual (Fase 3). */
export async function searchReceivedShipments(q: string): Promise<ReceivedSJ[]> {
	const res = await authedFetch(`/api/goods-received/complaint?q=${encodeURIComponent(q)}`);
	if (!res.ok) return [];
	const data = await res.json();
	return data.shipments || [];
}

export type ManualComplaintType = 'wrong_item' | 'damaged' | 'quality_issue' | 'other';

/** Komplain manual (Fase 3, Gap #4) — untuk masalah yang tidak terdeteksi otomatis saat GR. */
export async function submitManualComplaint(input: {
	suratJalanId: number;
	tipeKomplain: ManualComplaintType;
	keterangan: string;
	evidenceFileIds: string[];
	qtyKlaim?: number;
	nilaiKlaim?: number;
}): Promise<{ success: boolean; claimId: number | null }> {
	const res = await authedFetch('/api/goods-received/complaint', {
		method: 'POST',
		body: JSON.stringify(input)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err?.message || 'Gagal mengirim komplain.');
	}
	return res.json();
}
