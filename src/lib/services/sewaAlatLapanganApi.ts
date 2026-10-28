// src/lib/services/sewaAlatLapanganApi.ts
// Fase 6, Rencana Pertajam Rental Order v2 §9.2 L2/L3/L4 — "Alat Sewa di Site Saya" (lapangan).
// Baca-saja + satu aksi ringan (retur dini). Relasi (vendor, item, proyek) di-fetch TERPISAH,
// bukan nested fields, konsisten dengan pola erp-epi (CLAUDE.md Aturan #2).
import directus from './directus';
import { readItems, readItem, updateItem } from '@directus/sdk';
import { getProjectsForCurrentUser } from './projectScope';
import { hitungHariTersisa } from './sewaAlatDateUtils';

export { hitungHariTersisa };

/** Status fisik yang berarti "alat sedang di tangan kita" -- sama dengan STATUS_AKTIF_AKRUAL di rentalAccrualEngine.js (erp-epi). */
export const STATUS_SEWA_AKTIF = ['di_gudang', 'di_site', 'akan_kembali'];

export interface SewaAlatSiteItem {
	id: number;
	nama_barang: string;
	qty: number;
	satuan: string;
}

export interface SewaAlatSiteRow {
	id: number;
	project_id: number | null;
	project_name: string;
	vendor_name: string;
	status: string;
	start_date: string | null;
	end_date: string | null;
	actual_return_date: string | null;
	items: SewaAlatSiteItem[];
	/** Hari tersisa sampai end_date (negatif = sudah lewat tenggat). Null kalau end_date kosong. */
	hariTersisa: number | null;
}

/**
 * Daftar sewa_masuk AKTIF (sudah datang, belum retur) untuk proyek milik leader yang login.
 * TIDAK PERNAH query sewa_masuk tanpa filter project_id -- akan bocor data proyek lain.
 */
export async function fetchSewaAlatSiteSaya(): Promise<SewaAlatSiteRow[]> {
	const projects = (await getProjectsForCurrentUser(true)) || [];
	const projectIds = projects.map((p: any) => p.id);
	if (!projectIds.length) return [];

	const rows = (await directus.request(
		readItems('sewa_masuk' as any, {
			filter: {
				project_id: { _in: projectIds },
				status: { _in: STATUS_SEWA_AKTIF }
			},
			fields: ['id', 'project_id', 'vendor_contact_id', 'status', 'start_date', 'end_date', 'actual_return_date'],
			sort: ['end_date'],
			limit: -1
		})
	)) as any[];

	if (!rows.length) return [];

	const vendorIds = [...new Set(rows.map((r) => r.vendor_contact_id).filter(Boolean))];
	const vendorMap = new Map<number, string>();
	if (vendorIds.length) {
		const vendors = (await directus.request(
			readItems('contact' as any, { filter: { id: { _in: vendorIds } }, fields: ['id', 'name'], limit: -1 })
		)) as any[];
		vendors.forEach((v) => vendorMap.set(v.id, v.name));
	}

	const sewaIds = rows.map((r) => r.id);
	const items = (await directus.request(
		readItems('sewa_masuk_items' as any, {
			filter: { sewa_masuk_id: { _in: sewaIds } },
			fields: ['id', 'sewa_masuk_id', 'nama_barang', 'qty', 'satuan'],
			limit: -1
		})
	)) as any[];
	const itemsByHeader = new Map<number, SewaAlatSiteItem[]>();
	items.forEach((it) => {
		const arr = itemsByHeader.get(it.sewa_masuk_id) || [];
		arr.push({ id: it.id, nama_barang: it.nama_barang, qty: it.qty, satuan: it.satuan });
		itemsByHeader.set(it.sewa_masuk_id, arr);
	});

	const projectMap = new Map(projects.map((p: any) => [p.id, p.nama_project || p.name || `Proyek #${p.id}`]));

	return rows.map((r) => ({
		id: r.id,
		project_id: r.project_id,
		project_name: r.project_id ? projectMap.get(r.project_id) || '-' : '-',
		vendor_name: r.vendor_contact_id ? vendorMap.get(r.vendor_contact_id) || 'Vendor belum diisi' : 'Vendor belum diisi',
		status: r.status,
		start_date: r.start_date,
		end_date: r.end_date,
		actual_return_date: r.actual_return_date,
		items: itemsByHeader.get(r.id) || [],
		hariTersisa: hitungHariTersisa(r.end_date)
	}));
}

/**
 * L4 Retur Dini: leader minta alat dijemput vendor lebih awal karena sudah tidak dipakai.
 * SENGAJA TIDAK memotong stok atau menjurnal apa pun di sini -- itu hanya boleh terjadi lewat
 * scan gate satpam saat vendor BENAR-BENAR menjemput alatnya (OUT-13). Fungsi ini murni
 * menandai niat/permintaan supaya admin & satpam tahu untuk bersiap menerima retur.
 */
export async function requestReturDini(sewaMasukId: number, alasan: string, requestedByName: string): Promise<void> {
	if (!sewaMasukId) throw new Error('sewaMasukId wajib diisi');
	if (!alasan?.trim()) throw new Error('Alasan retur dini wajib diisi');

	const existing = (await directus.request(
		readItem('sewa_masuk' as any, sewaMasukId, { fields: ['id', 'notes', 'status'] })
	)) as any;

	const tanggal = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
	const catatanBaru = `[Retur dini diminta ${tanggal} oleh ${requestedByName}] ${alasan.trim()}`;
	const notesGabungan = existing?.notes ? `${existing.notes}\n${catatanBaru}` : catatanBaru;

	await directus.request(
		updateItem('sewa_masuk' as any, sewaMasukId, {
			status: 'akan_kembali',
			notes: notesGabungan
		})
	);
}
