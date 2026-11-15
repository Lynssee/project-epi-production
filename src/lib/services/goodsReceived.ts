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

/** PO drop-ship yang sedang menuju site (read-only; lihat server/goodsReceived/dropshipOrders.ts). */
export interface DropshipOrderView {
	poId: number;
	poNumber: string;
	supplierName: string;
	projectId: number;
	projectName: string;
	status: string;
	eta: string | null;
	items: Array<{ name: string; qty: number; received: number; unit: string }>;
	sisaQty: number;
}

/** Daftar PO drop-ship yang sedang menuju proyek leader yang login (dikirim supplier langsung ke site). */
export async function fetchDropshipOrders(): Promise<DropshipOrderView[]> {
	const res = await authedFetch('/api/goods-received/dropship');
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err?.message || 'Gagal mengambil daftar barang drop-ship.');
	}
	const data = await res.json();
	return data.orders || [];
}

export interface GRShipment {
	suratJalanId: number;
	nomorSJ: string;
	driver: string | null;
	/** Info perjalanan (Fase 6) — opsional; kosong bila SJ belum punya kendaraan / tidak lewat armada. Tanpa GPS. */
	plat?: string | null;
	modeKirim?: string | null;
	etaTiba?: string | null;
	noResi?: string | null;
	tanggalKirim: string;
	qrToken: string | null;
	projectId: number | null;
	projectName: string;
	items: GRItem[];
}

export interface GREvidence {
	/** Inventory 360° Fase C: hasil checklist terima per barang [{ itemId, profileId, items:[{id,text}], checked:[id] }]. */
	inspeksi?: Array<{ itemId: number; profileId: number | null; items: Array<{ id: string; text: string }>; checked: string[] }>;
	/** id barang master yang diterima (untuk evaluasi gate shadow, termasuk yang tidak dicentang). */
	identitasBarangIds?: number[];
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
	backhaul?: boolean; // titip balik ke supir (hanya untuk condition 'salah_spek')
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

export interface SjBarang {
	identitasBarangId: number;
	namaBarang: string;
	qtySent: number;
}

/** Barang pada SJ yang bisa dipilih sebagai barang bermasalah (hanya yang punya barang master — bisa dikunci). Gagal => []. */
export async function fetchSjBarang(suratJalanId: number): Promise<SjBarang[]> {
	const res = await authedFetch(`/api/goods-received/complaint?sjId=${encodeURIComponent(String(suratJalanId))}`);
	if (!res.ok) {
		console.warn('[goodsReceived] gagal memuat barang SJ untuk komplain:', res.status);
		return [];
	}
	return (await res.json())?.items || [];
}

export type ManualComplaintType ='wrong_item' | 'damaged' | 'quality_issue' | 'other';
/** Hanya relevan untuk 'wrong_item': salah kirim dari Gudang/Vendor vs salah pesan dari proyek (spek PR/PO keliru). */
export type ManualComplaintSource = 'salah_kirim_gudang' | 'salah_pesan_proyek';

/** Komplain manual (Fase 3, Gap #4) — untuk masalah yang tidak terdeteksi otomatis saat GR. */
export async function submitManualComplaint(input: {
	suratJalanId: number;
	tipeKomplain: ManualComplaintType;
	keterangan: string;
	evidenceFileIds: string[];
	qtyKlaim?: number;
	nilaiKlaim?: number;
	sumberMasalah?: ManualComplaintSource;
	/** Barang yang bermasalah — dikunci dari Laporan Harian sampai Admin memutuskan (G_PROYEK_KOMPLAIN_LOCK). */
	items?: Array<{ identitasBarangId: number; qty?: number }>;
}): Promise<{
	success: boolean;
	claimId: number | null;
	bermasalahLogged?: boolean;
	lockedItems?: number;
	/** Item retur siap-ajukan (barang salah/rusak yang dikomplain); null bila tak memenuhi syarat. */
	returSiap?: {
		projectId: number;
		nomorSj: string;
		items: Array<{ item_id: number; material_name: string; qty_returned: number; unit: string; condition: 'ok' | 'rusak'; leader_notes: string }>;
	} | null;
}> {
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
