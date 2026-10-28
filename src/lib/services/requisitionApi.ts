// src/lib/services/requisitionApi.ts
// Client tipis untuk fitur Requisition (Pengajuan Internal Barang) di dashboard
// lapangan. Memanggil route server project-epi sendiri (/api/requisition/*),
// yang menulis langsung ke Directus bersama — bukan cross-app HTTP call.

import { getIdToken } from './secureDirectus';
import { secureDirectusJson } from './secureDirectus';

async function authedFetch(path: string, options: RequestInit = {}) {
	const token = await getIdToken();
	const { headers = {}, ...rest } = options;
	const res = await fetch(path, {
		...rest,
		headers: {
			'Content-Type': 'application/json',
			...headers,
			Authorization: `Bearer ${token}`
		}
	});
	const text = await res.text();
	let parsed: any = null;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		/* non-JSON */
	}
	if (!res.ok) {
		throw new Error(parsed?.message || `Request gagal (${res.status})`);
	}
	return parsed;
}

export interface RequisitionItemPayload {
	identitas_barang_id?: number | null;
	nama_barang?: string | null;
	quantity_requested: number;
	units?: string | null;
	estimated_unit_price?: number | null;
}

export interface SubmitRequisitionPayload {
	requisitionType: 'project_material' | 'general_internal';
	projectId?: number | null;
	spkId?: number | null;
	tujuanPenggunaan?: string | null;
	tanggalDibutuhkan?: string | null;
	destinationPicName?: string | null;
	destinationAddress?: string | null;
	accountCode?: string | null;
	/** F5.2 — tandai mendesak: memicu WA ke rantai approval + GM. */
	urgent?: boolean;
	urgentReason?: string | null;
	items: RequisitionItemPayload[];
}

export async function submitRequisition(payload: SubmitRequisitionPayload) {
	const result = await authedFetch('/api/requisition', {
		method: 'POST',
		body: JSON.stringify(payload)
	});
	return result?.data;
}

export async function listMyRequisitions() {
	const result = await authedFetch('/api/requisition', { method: 'GET' });
	return result?.data || [];
}

export async function getRequisitionDetail(id: number | string) {
	const result = await authedFetch(`/api/requisition/${id}`, { method: 'GET' });
	return result?.data;
}

/** Cari identitas_barang untuk autocomplete item pengajuan. */
export async function searchIdentitasBarang(query: string) {
	const q = query.trim();
	const url = q
		? `/items/identitas_barang?filter[nama_barang_lengkap][_icontains]=${encodeURIComponent(q)}&fields=id,nama_barang_lengkap,satuan,harga_beli,stok_tersedia,kode_item,item_group_id&limit=20`
		: `/items/identitas_barang?fields=id,nama_barang_lengkap,satuan,harga_beli,stok_tersedia,kode_item,item_group_id&limit=20&sort=nama_barang_lengkap`;
	const res = await secureDirectusJson(url);
	return res?.data || [];
}

/**
 * Saran equivalent — cari anggota grup lain yang sudah di-approve dan punya stok, untuk
 * ditawarkan saat item pilihan user stoknya kosong. Sama seperti fetchEquivalentSuggestions
 * di admin ERP (procurementApi.js) — lihat memory feedback-stok-tersedia-string-type: field
 * stok_tersedia bertipe STRING di Directus, operator _gt/_lt TIDAK didukung, jadi filter stok>0
 * dilakukan di client, bukan di query.
 */
export async function fetchEquivalentSuggestions(itemGroupId: string | null | undefined, excludeItemId: number) {
	if (!itemGroupId) return [];
	const url =
		`/items/identitas_barang?filter[item_group_id][_eq]=${encodeURIComponent(itemGroupId)}` +
		`&filter[id][_neq]=${excludeItemId}` +
		`&filter[group_approval_status][_eq]=approved` +
		`&fields=id,nama_barang_lengkap,satuan,harga_beli,stok_tersedia,kode_item&limit=50`;
	const res = await secureDirectusJson(url);
	const data = res?.data || [];
	return data
		.filter((it: any) => (parseFloat(it.stok_tersedia) || 0) > 0)
		.sort((a: any, b: any) => (parseFloat(a.harga_beli) || 0) - (parseFloat(b.harga_beli) || 0))
		.slice(0, 10);
}

export const REQUISITION_STATUS_LABEL: Record<string, string> = {
	draft: 'Draft',
	submitted_dept: 'Diajukan ke Atasan',
	pending_direktur: 'Menunggu Direktur',
	approved_pending_inventory: 'Disetujui - Menunggu Inventory',
	inventory_processing: 'Diproses Inventory',
	partially_fulfilled: 'Terpenuhi Sebagian',
	fulfilled: 'Terpenuhi',
	needs_purchase_pending: 'Menunggu Pembelian',
	po_created: 'PO Dibuat',
	in_procurement: 'Proses Pembelian',
	rejected: 'Ditolak',
	cancelled: 'Dibatalkan'
};

export const REQUISITION_ITEM_STATUS_LABEL: Record<string, string> = {
	pending_verification: 'Menunggu Verifikasi',
	in_stock_reserved: 'Tersedia - Dikunci',
	in_stock_issued: 'Tersedia - Dikeluarkan',
	out_of_stock_needs_purchase: 'Stok Kosong - Perlu Beli',
	po_created: 'PO Dibuat',
	in_procurement: 'Dalam Proses PO',
	cancelled: 'Dibatalkan'
};
