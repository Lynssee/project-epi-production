// src/lib/services/cekAreaApi.ts
// Fase 3 (Rencana Sistem Penempatan Area Inventory & Verifikasi Barcode v2, 20 Agu 2026):
// verifikasi/cek-area rak dari lapangan. Baca langsung lewat secureDirectusFetch (proxy
// terautentikasi); tulis lewat /api/stock-lapangan/cek-area supaya identitas verified_by
// di-resolve server-side (tidak bisa dipalsukan klien).

import { secureDirectusFetch, getIdToken } from './secureDirectus';

export interface GudangRow {
	id: number;
	kode_gudang: string | null;
	nama_gudang: string;
	jenis: string | null;
	parent_gudang_id: number | null;
	pic_karyawan_ids: number[] | null;
}

async function dget<T = any>(path: string): Promise<T[]> {
	const res = await secureDirectusFetch(path);
	if (!res.ok) return [];
	const json = await res.json();
	return json.data || [];
}

/**
 * Resolusi QR EPI:LOC:<id> -- kalau node ini rak/zona (punya induk) ATAU sudah punya
 * penempatan item, ini "area" yang bisa di-cek-area-kan. Kalau tidak (gudang level
 * teratas tanpa penempatan), kembalikan null supaya pemanggil pakai fallback 3 tombol lama.
 */
export async function resolveGudangArea(id: number): Promise<GudangRow | null> {
	// endpoint /items/gudang/<id> mengembalikan objek tunggal, bukan array, jadi dget()
	// (yang mengasumsikan json.data array) tidak dipakai di sini -- fetch manual.
	const res = await secureDirectusFetch(
		`/items/gudang/${id}?fields=id,kode_gudang,nama_gudang,jenis,parent_gudang_id,pic_karyawan_ids`
	);
	if (!res.ok) return null;
	const gudang: GudangRow = (await res.json()).data;
	if (!gudang) return null;
	if (gudang.parent_gudang_id) return gudang;

	const placements = await dget(`/items/gudang_item_placement?filter[gudang_id][_eq]=${id}&limit=1&fields=id`);
	if (placements.length > 0) return gudang;

	return null;
}

export interface PlacementRow {
	id: number;
	identitas_barang_id: number;
	expected_qty: number | null;
	item?: { id: number; nama_barang_lengkap: string; kode_item: string | null; satuan: string | null };
	ledgerQty?: number | null;
}

export interface PicRow {
	id: number;
	nama_karyawan: string;
	no_hp: string | null;
}

export async function fetchAreaDetail(
	gudangId: number
): Promise<{ gudang: GudangRow; parentNama: string | null; placements: PlacementRow[]; pics: PicRow[] }> {
	const res = await secureDirectusFetch(
		`/items/gudang/${gudangId}?fields=id,kode_gudang,nama_gudang,jenis,parent_gudang_id,pic_karyawan_ids`
	);
	if (!res.ok) throw new Error('Gagal memuat data rak');
	const gudang: GudangRow = (await res.json()).data;

	let parentNama: string | null = null;
	if (gudang.parent_gudang_id) {
		const parentRows = await dget<any>(`/items/gudang?filter[id][_eq]=${gudang.parent_gudang_id}&fields=nama_gudang&limit=1`);
		parentNama = parentRows[0]?.nama_gudang || null;
	}

	const rows = await dget<any>(`/items/gudang_item_placement?filter[gudang_id][_eq]=${gudangId}&sort=urutan&limit=-1`);
	const itemIds = [...new Set(rows.map((r) => r.identitas_barang_id).filter(Boolean))];
	const items = itemIds.length
		? await dget(`/items/identitas_barang?filter[id][_in]=${itemIds.join(',')}&fields=id,nama_barang_lengkap,kode_item,satuan&limit=-1`)
		: [];
	const itemMap = new Map(items.map((i: any) => [i.id, i]));

	const tx = await dget(
		`/items/stock_transactions?filter[gudang_id][_eq]=${gudangId}&fields=item_id,previous_stock,new_stock,quantity,category_transaction&limit=-1`
	);
	const ledgerMap = new Map<number, number>();
	for (const t of tx) {
		if (t.item_id == null) continue;
		// TRANSFER-RAK-IN/OUT: pindah lokasi rak dari Kiosk Gudang (Fase 2 rencana "Penajaman
		// Kiosk Inventory") — net-nol di stok global, qty per-rak dari `quantity` bertanda.
		const cat = t.category_transaction;
		const delta =
			cat === 'TRANSFER-IN-PROYEK' || cat === 'TRANSFER-RAK-IN'
				? Number(t.quantity) || 0
				: cat === 'TRANSFER-RAK-OUT'
					? -(Number(t.quantity) || 0)
					: (Number(t.new_stock) || 0) - (Number(t.previous_stock) || 0);
		ledgerMap.set(t.item_id, (ledgerMap.get(t.item_id) || 0) + delta);
	}

	const placements: PlacementRow[] = rows.map((r) => ({
		id: r.id,
		identitas_barang_id: r.identitas_barang_id,
		expected_qty: r.expected_qty,
		item: itemMap.get(r.identitas_barang_id),
		ledgerQty: ledgerMap.has(r.identitas_barang_id) ? ledgerMap.get(r.identitas_barang_id) : null
	}));

	let pics: PicRow[] = [];
	if (gudang.pic_karyawan_ids?.length) {
		pics = await dget(`/items/karyawan?filter[id][_in]=${gudang.pic_karyawan_ids.join(',')}&fields=id,nama_karyawan,no_hp&limit=-1`);
	}

	return { gudang, parentNama, placements, pics };
}

export interface DenahContext {
	gambarId: string;
	namaDenah: string;
	x_pct: number;
	y_pct: number;
}

/** Konteks visual: denah tempat rak ini dipetakan (Fase 2) + posisi pin-nya, untuk disorot
 *  di header halaman cek-area. null kalau rak ini belum pernah dipetakan di denah mana pun. */
export async function fetchAreaDenahContext(gudangId: number): Promise<DenahContext | null> {
	const pins = await dget<any>(`/items/ga_denah_pin?filter[gudang_id][_eq]=${gudangId}&limit=1&fields=denah_id,x_pct,y_pct`);
	if (!pins.length) return null;
	const pin = pins[0];
	const denahRows = await dget<any>(`/items/ga_denah?filter[id][_eq]=${pin.denah_id}&limit=1&fields=id,nama,gambar`);
	const denah = denahRows[0];
	if (!denah?.gambar) return null;
	return { gambarId: denah.gambar, namaDenah: denah.nama, x_pct: pin.x_pct, y_pct: pin.y_pct };
}

export interface CekAreaItemInput {
	identitas_barang_id: number;
	expected_qty: number | null;
	actual_qty: number;
	jenis_masalah?: string | null;
	severity?: string | null;
	deskripsi?: string | null;
}

export interface CekAreaSubmitPayload {
	gudang_id: number;
	client_txn_id: string;
	items: CekAreaItemInput[];
	jenis?: string;
	catatan?: string | null;
	gps_lat?: number | null;
	gps_lng?: number | null;
	source?: string;
	/** File id (directus_files) hasil uploadEvidencePhoto -- kosong kalau offline (lihat
	 *  catatan keterbatasan foto offline di [gudang_id]/+page.svelte). */
	foto_kondisi?: string | null;
}

export async function submitCekArea(payload: CekAreaSubmitPayload): Promise<{ success: boolean; id?: number; status?: string }> {
	const token = await getIdToken();
	const res = await fetch('/api/stock-lapangan/cek-area', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify(payload)
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new Error(data?.message || `Gagal mengirim hasil cek-area (${res.status})`);
	}
	return res.json();
}

export interface RecentCekArea {
	id: number;
	gudang_id: number;
	gudang_nama: string;
	status: string;
	date_created: string;
}

/** "Riwayat terakhir" + "berapa area sudah dicek hari ini" untuk halaman entry cek-area. */
export async function fetchRecentCekArea(limit = 5): Promise<RecentCekArea[]> {
	const rows = await dget<any>(`/items/gudang_verifikasi?sort=-date_created&limit=${limit}&fields=id,gudang_id,status,date_created`);
	if (!rows.length) return [];
	const gudangIds = [...new Set(rows.map((r) => r.gudang_id).filter(Boolean))];
	const gudangRows = gudangIds.length
		? await dget(`/items/gudang?filter[id][_in]=${gudangIds.join(',')}&fields=id,nama_gudang&limit=-1`)
		: [];
	const gudangMap = new Map(gudangRows.map((g: any) => [g.id, g.nama_gudang]));
	return rows.map((r) => ({
		id: r.id,
		gudang_id: r.gudang_id,
		gudang_nama: gudangMap.get(r.gudang_id) || `#${r.gudang_id}`,
		status: r.status,
		date_created: r.date_created
	}));
}
