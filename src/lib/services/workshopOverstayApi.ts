// src/lib/services/workshopOverstayApi.ts
// Pertajam Modul Ciketing — Denda Overstay & PO Bayangan, sisi Dashboard Lapangan
// (Fase 1+2 lanjutan, 22 Sep 2026). Sumber data SAMA dengan admin erp-epi
// (ciketing_customer_placement) — tidak ada koleksi/endpoint terpisah, supaya status
// yang dilihat lapangan selalu identik dengan admin (Aturan Anti-Kesalahan #8).
//
// Lapangan HANYA bisa: lihat daftar overstay + konfirmasi pengambilan barang, dan
// lihat status PO Bayangan proyek mereka. Aksi finansial (tandai lunas, bebaskan
// denda, konfirmasi PO masuk) tetap admin-only (erp-epi) — itu keputusan Finance/
// Procurement, bukan lapangan.

import directus from './directus';
import { readItems, updateItem, uploadFiles } from '@directus/sdk';
import { getProjectsForCurrentUser } from './projectScope';

const COLLECTION = 'ciketing_customer_placement';

const OVERSTAY_FIELDS = [
	'id',
	'gudang_id',
	'project_id',
	'customer_name',
	'nama_barang',
	'qty',
	'satuan',
	'tipe_overstay',
	'tanggal_mulai_overstay',
	'grace_deadline',
	'tanggal_ambil',
	'hari_overstay',
	'total_denda',
	'denda_status',
	'denda_catatan'
] as const;

export interface OverstayCase {
	id: number;
	gudang_id: number | null;
	project_id: number | null;
	customer_name: string | null;
	nama_barang: string;
	qty: number | null;
	satuan: string | null;
	tipe_overstay: string;
	tanggal_mulai_overstay: string | null;
	grace_deadline: string | null;
	tanggal_ambil: string | null;
	hari_overstay: number | null;
	total_denda: number | null;
	denda_status: string | null;
	denda_catatan: string | null;
}

export const TIPE_OVERSTAY_LABEL: Record<string, string> = {
	parkir_customer_vendor: 'Parkir Customer/Vendor',
	titipan_pihak_luar: 'Titipan Pihak Luar',
	selesai_belum_diambil: 'Selesai, Belum Diambil'
};

/**
 * Kasus overstay yang MASIH BUTUH TINDAKAN lapangan (belum diambil).
 * Ciketing-wide (bukan per-proyek) — petugas gudang perlu lihat semua, tidak
 * dibatasi ke proyek mereka sendiri (barang bisa titipan tanpa project_id).
 */
export async function fetchActiveOverstays(): Promise<OverstayCase[]> {
	const rows = (await directus.request(
		readItems(COLLECTION as any, {
			filter: {
				tipe_overstay: { _nnull: true },
				is_active: { _eq: true },
				tanggal_ambil: { _null: true }
			} as any,
			fields: OVERSTAY_FIELDS as any,
			sort: ['-hari_overstay'] as any,
			limit: -1
		})
	)) as any[];
	return rows as OverstayCase[];
}

/** Upload foto bukti serah-terima pengambilan barang overstay. Return file id Directus. */
export async function uploadOverstayPickupPhoto(file: File | Blob, name: string): Promise<string | null> {
	const formData = new FormData();
	formData.append('file', file, name);
	const result: any = await directus.request(uploadFiles(formData));
	return result?.id || null;
}

export interface ConfirmPickupInput {
	catatan?: string;
	fotoFileId: string;
	signatureDataUrl: string;
	namaPenerima: string;
}

/**
 * Konfirmasi barang overstay sudah diambil (dari lapangan). Foto bukti + TTD digital +
 * nama penerima WAJIB (bukti serah-terima untuk dispute resolution) — rencana awal
 * "Photo Gate pada Pengambilan Barang Overstay", dikonfirmasi user 22 Sep 2026.
 */
export async function confirmOverstayPickup(id: number, input: ConfirmPickupInput): Promise<void> {
	if (!input.fotoFileId) throw new Error('Foto bukti pengambilan wajib diisi');
	if (!input.signatureDataUrl) throw new Error('Tanda tangan penerima wajib diisi');
	if (!input.namaPenerima?.trim()) throw new Error('Nama penerima wajib diisi');

	const existing = (await directus.request(
		readItems(COLLECTION as any, { filter: { id: { _eq: id } } as any, fields: ['total_denda', 'denda_catatan'] as any, limit: 1 })
	)) as any[];
	const row = existing?.[0];
	const totalDenda = Number(row?.total_denda || 0);
	const now = new Date().toISOString();
	await directus.request(
		updateItem(COLLECTION as any, id, {
			tanggal_ambil: now,
			denda_status: totalDenda > 0 ? 'diambil' : 'lunas',
			bukti_foto_pengambilan: input.fotoFileId,
			ttd_pengambilan: input.signatureDataUrl,
			nama_penerima_pengambilan: input.namaPenerima.trim(),
			denda_catatan: input.catatan
				? `${row?.denda_catatan ? row.denda_catatan + '\n' : ''}[Diambil - lapangan] ${input.catatan}`
				: row?.denda_catatan
		} as any)
	);
}

// ─── PO Bayangan (proyek tanpa PO) — scoped ke proyek pengguna ────────────

export interface PoBayanganCase {
	id: number;
	project_id: number | null;
	customer_name: string | null;
	nama_barang: string;
	po_status: string | null;
}

export const PO_STATUS_LABEL: Record<string, string> = {
	belum_ada_po: 'Belum Ada PO',
	po_menyusul: 'PO Menyusul',
	po_dikonfirmasi: 'PO Dikonfirmasi'
};

/** Proyek tanpa PO milik pengguna saat ini (leader/kursi proyek yang sama seperti Papan Order). */
export async function fetchMyPoBayangan(): Promise<PoBayanganCase[]> {
	const myProjects = await getProjectsForCurrentUser(true);
	const myProjectIds = (myProjects || []).map((p: any) => p.id).filter(Boolean);
	if (!myProjectIds.length) return [];

	const rows = (await directus.request(
		readItems(COLLECTION as any, {
			filter: {
				is_active: { _eq: true },
				project_id: { _in: myProjectIds },
				nomor_po: { _null: true }
			} as any,
			fields: ['id', 'project_id', 'customer_name', 'nama_barang', 'po_status'] as any,
			limit: -1
		})
	)) as any[];
	return rows as PoBayanganCase[];
}
