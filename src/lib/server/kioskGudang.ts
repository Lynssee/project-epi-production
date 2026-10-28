// src/lib/server/kioskGudang.ts
// SERVER-ONLY. Cermin server-side (token Directus, tanpa Firebase) dari alur Persiapan Gudang
// untuk terminal Kiosk Gudang: Antrian pick, Persiapan harian, Opname.
// Logika query = port dari gudangAntrian.ts + stockLapangan.ts (yang pakai directus SDK client).
// Fase 3, rencana "Penajaman Kiosk Inventory — Cek Lokasi Rak & Qty Barang" (8 Sep 2026).

import { directusServerJson } from '$lib/server/directus';
import { casPatchBody } from '$lib/server/directusCas';
import { triggerN8nInventoryAlert } from '$lib/server/kioskAlert';
import { parseStok, formatStok } from '$lib/utils/stokFormat';
import { fetchLedgerQtyForGudang } from '$lib/server/kioskStok';

async function dget<T = any>(path: string): Promise<T[]> {
	try {
		const res = await directusServerJson<{ data: T[] }>(path);
		return res?.data || [];
	} catch (e) {
		console.warn('[kioskGudang] gagal fetch', path, e);
		return [];
	}
}

/** File 05 §2.4 — varian `dget` yang MELEMPAR error alih-alih menelannya (mengembalikan `[]`).
 *  `dget()` biasa hanya boleh dipakai untuk tampilan (read-only): kalau Directus lambat/timeout
 *  di JALUR TULIS, `dget` diam-diam menganggap "belum ada" dan proses lanjut menulis ulang
 *  (mis. cek idempotensi client_txn_id palsu-negatif → potong stok dua kali). Aturan #1. */
async function dgetStrict<T = any>(path: string): Promise<T[]> {
	const res = await directusServerJson<{ data: T[] }>(path);
	return res?.data || [];
}

/** Baca satu setelan inventory.* dari koleksi system_settings, dengan default di kode. */
async function readInvSetting<T>(key: string, fallback: T): Promise<T> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=${encodeURIComponent(key)}&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		if (raw === undefined || raw === null || raw === '') return fallback;
		try {
			return JSON.parse(raw) as T;
		} catch {
			return raw as T;
		}
	} catch {
		return fallback;
	}
}

export interface GudangHqGate {
	gudang_hq_enabled: boolean;
	persiapan_hub_enabled: boolean;
	opname_toleransi_pct: number;
	opname_wajib_approval: boolean;
}

export async function readGudangHqGate(): Promise<GudangHqGate> {
	const [hq, hub, tol, wajib] = await Promise.all([
		readInvSetting<boolean>('inventory.gudang_hq.enabled', false),
		readInvSetting<boolean>('inventory.persiapan.hub_enabled', true),
		readInvSetting<number>('inventory.gudang_hq.toleransi_selisih_pct', 0),
		readInvSetting<boolean>('inventory.gudang_hq.opname_wajib_approval', true)
	]);
	return {
		gudang_hq_enabled: hq === true,
		persiapan_hub_enabled: hub !== false,
		opname_toleransi_pct: Number(tol) || 0,
		opname_wajib_approval: wajib !== false
	};
}

// ============================================================
// Antrian Persiapan (packing_list) — READ
// ============================================================

const ACTIONABLE_STATUS = 'active,approved';

export interface KioskAntrianItemLokasi {
	gudang_id: number;
	nama_rak: string;
	kode_rak: string | null;
	/** File 06 §2.3 — saldo ledger barang ini DI RAK INI (bukan stok global), dipakai operator
	 *  memilih dari rak mana barang diambil saat ada di > 1 rak. */
	qty_tercatat?: number;
}

export interface KioskAntrianItem {
	id: number;
	item_id: number | null;
	nama_barang: string;
	qty_required: number;
	qty_delivered: number;
	unit: string;
	stok_tersedia: number | null;
	stok_level: 'hijau' | 'kuning' | 'merah' | 'tidak_diketahui';
	lokasi_rak?: KioskAntrianItemLokasi[];
}

export interface KioskAntrianRow {
	id: number;
	nomor_pl: string;
	status: string;
	prep_status: string;
	priority: string;
	urgency: string;
	needed_date: string | null;
	request_date: string | null;
	requested_by_department: string;
	destination_pic_name: string;
	gudang_id: number | null;
	assigned_to: number | null;
	assigned_to_name: string | null;
	request_type: string;
	item_count: number;
	items_completed?: number;
}

export interface KioskAntrianDetail extends KioskAntrianRow {
	items: KioskAntrianItem[];
}

function stokLevel(stok: number | null, need: number): KioskAntrianItem['stok_level'] {
	if (stok === null || Number.isNaN(stok)) return 'tidak_diketahui';
	if (stok <= 0) return 'merah';
	if (stok < need) return 'kuning';
	return 'hijau';
}

const PL_HEADER_FIELDS =
	'id,nomor_pl,status,prep_status,priority,urgency,needed_date,request_date,requested_by_department,destination_pic_name,gudang_id,assigned_to,assigned_to_name,request_type';

function mapHeader(r: any, itemCount: number, itemsCompleted = 0): KioskAntrianRow {
	let prepStatus = r.prep_status || 'pending';
	if (prepStatus === 'pending' && itemsCompleted > 0) {
		prepStatus = itemsCompleted >= itemCount ? 'packed' : 'picking';
	}

	return {
		id: r.id,
		nomor_pl: r.nomor_pl || `PL-${r.id}`,
		status: r.status || '',
		prep_status: prepStatus,
		priority: r.priority || 'normal',
		urgency: r.urgency || 'normal',
		needed_date: r.needed_date || null,
		request_date: r.request_date || null,
		requested_by_department: r.requested_by_department || '',
		destination_pic_name: r.destination_pic_name || '',
		gudang_id: r.gudang_id ?? null,
		assigned_to: r.assigned_to ?? null,
		assigned_to_name: r.assigned_to_name ?? null,
		request_type: r.request_type || '',
		item_count: itemCount,
		items_completed: itemsCompleted
	};
}

export async function listAntrian(limit = 100): Promise<KioskAntrianRow[]> {
	const rows = await dget<any>(
		`/items/packing_list?fields=${PL_HEADER_FIELDS}` +
			`&filter[status][_in]=${ACTIONABLE_STATUS}` +
			`&filter[_or][0][prep_status][_null]=true&filter[_or][1][prep_status][_neq]=dispatched` +
			`&sort=-priority,needed_date&limit=${limit}`
	);
	if (!rows.length) return [];
	const plIds = rows.map((r) => r.id);
	const itemRows = await dget<any>(
		`/items/packing_list_items?fields=packing_list_id,qty_required,qty_delivered&filter[packing_list_id][_in]=${plIds.join(',')}&limit=-1`
	);
	const counts: Record<number, number> = {};
	const completedCounts: Record<number, number> = {};
	for (const r of itemRows) {
		const plId = r.packing_list_id;
		counts[plId] = (counts[plId] || 0) + 1;
		const req = Number(r.qty_required) || 0;
		const del = Number(r.qty_delivered) || 0;
		if (req > 0 && del >= req - 0.0001) {
			completedCounts[plId] = (completedCounts[plId] || 0) + 1;
		}
	}
	return rows.map((r) => mapHeader(r, counts[r.id] || 0, completedCounts[r.id] || 0));
}

export async function getAntrianDetail(packingListId: number): Promise<KioskAntrianDetail | null> {
	const [headerRows, itemRows] = await Promise.all([
		dget<any>(`/items/packing_list?fields=${PL_HEADER_FIELDS}&filter[id][_eq]=${packingListId}&limit=1`),
		dget<any>(
			`/items/packing_list_items?fields=id,item_id,nama_barang,qty_required,qty_delivered,unit&filter[packing_list_id][_eq]=${packingListId}&limit=-1`
		)
	]);
	const header = headerRows[0];
	if (!header) return null;

	const itemIds = [
		...new Set(
			itemRows
				.map((r) => (typeof r.item_id === 'object' ? Number(r.item_id?.id) : Number(r.item_id)))
				.filter((id) => Number.isFinite(id) && id > 0)
		)
	];

	// Directus query per relasi terpisah:
	// 1) Ambil stok tersedia dari identitas_barang
	// 2) Ambil placement rak dari gudang_item_placement
	const [stokRows, placementRows] = await Promise.all([
		itemIds.length
			? dget<any>(`/items/identitas_barang?fields=id,stok_tersedia&filter[id][_in]=${itemIds.join(',')}&limit=-1`)
			: Promise.resolve([]),
		itemIds.length
			? dget<any>(
					`/items/gudang_item_placement?fields=identitas_barang_id,gudang_id&filter[identitas_barang_id][_in]=${itemIds.join(',')}&limit=-1`
				)
			: Promise.resolve([])
	]);
	const stokMap = new Map(stokRows.map((r: any) => [Number(r.id), r.stok_tersedia]));

	// 3) Ambil nama rak dari tabel gudang secara terpisah
	const rakIds = [
		...new Set(
			placementRows
				.map((p: any) => (typeof p.gudang_id === 'object' ? Number(p.gudang_id?.id) : Number(p.gudang_id)))
				.filter((id) => Number.isFinite(id) && id > 0)
		)
	];
	const rakRows = rakIds.length
		? await dget<any>(`/items/gudang?fields=id,nama_gudang,kode_gudang&filter[id][_in]=${rakIds.join(',')}&limit=-1`)
		: [];
	const rakMap = new Map(rakRows.map((r: any) => [Number(r.id), r]));

	// File 06 §2.3 — saldo per rak (bukan expected_qty rencana), satu panggilan per rak yang
	// terlibat (biasanya sedikit untuk satu packing list), dijalankan paralel.
	const ledgerByRak = new Map<number, Map<number, number>>();
	await Promise.all(rakIds.map(async (rid) => {
		ledgerByRak.set(rid, await fetchLedgerQtyForGudang(rid, itemIds));
	}));

	// Susun peta lokasi rak per item_id
	const itemRakMap = new Map<number, KioskAntrianItemLokasi[]>();
	for (const p of placementRows) {
		const itemId = typeof p.identitas_barang_id === 'object' ? Number(p.identitas_barang_id?.id) : Number(p.identitas_barang_id);
		const gId = typeof p.gudang_id === 'object' ? Number(p.gudang_id?.id) : Number(p.gudang_id);
		if (!itemId || !gId) continue;
		const r = rakMap.get(gId);
		if (!r) continue;
		if (!itemRakMap.has(itemId)) itemRakMap.set(itemId, []);
		itemRakMap.get(itemId)!.push({
			gudang_id: gId,
			nama_rak: r.nama_gudang || `Rak #${gId}`,
			kode_rak: r.kode_gudang || null,
			qty_tercatat: ledgerByRak.get(gId)?.get(itemId) ?? 0
		});
	}

	const items: KioskAntrianItem[] = itemRows.map((r) => {
		const itId = typeof r.item_id === 'object' ? Number(r.item_id?.id) : Number(r.item_id);
		const stok = itId && stokMap.get(itId) != null ? parseStok(stokMap.get(itId)) : null;
		const need = Number(r.qty_required) || 0;
		return {
			id: r.id,
			item_id: itId || null,
			nama_barang: r.nama_barang || '',
			qty_required: need,
			qty_delivered: Number(r.qty_delivered) || 0,
			unit: r.unit || '',
			stok_tersedia: stok,
			stok_level: stokLevel(stok, need),
			lokasi_rak: itId ? itemRakMap.get(itId) || [] : []
		};
	});

	return { ...mapHeader(header, items.length), items };
}

// ============================================================
// Persiapan harian — READ
// ============================================================

export interface KioskPersiapanHarian {
	reorder_alerts: Array<{ item_id: number; nama_barang: string; satuan: string; stok_tersedia: number; stok_minimum: number }>;
	spk_reservations: Array<{
		item_id: number;
		nama_barang: string;
		satuan: string;
		spk_id: number;
		quantity: number;
		stok_tersedia?: number | null;
		is_cukup?: boolean | null;
	}>;
	packing_pipeline: Array<{ id: number; material_name: string; qty: number; unit: string; packing_status: string; requested_at: string | null }>;
	finish_good: Array<{ item_id: number; nama_barang: string; satuan: string; stok_tersedia: number }>;
}

async function fetchItemNameMap(itemIds: number[]): Promise<Map<number, { nama: string; satuan: string }>> {
	const map = new Map<number, { nama: string; satuan: string }>();
	const ids = [...new Set(itemIds.filter(Boolean))];
	if (!ids.length) return map;
	const rows = await dget<any>(
		`/items/identitas_barang?fields=id,nama_barang_lengkap,satuan&filter[id][_in]=${ids.join(',')}&limit=-1`
	);
	for (const r of rows) map.set(r.id, { nama: r.nama_barang_lengkap, satuan: r.satuan });
	return map;
}

export async function getPersiapanHarian(fgCategoryIds: number[]): Promise<KioskPersiapanHarian> {
	const fgFilter = fgCategoryIds.length ? `&filter[parent_category][_in]=${fgCategoryIds.join(',')}` : '';

	const [reorderCandidates, reservations, pipeline, fgItems] = await Promise.all([
		// 1. Ambil hanya item yang memiliki ambang stok minimum > 0
		dget<any>(
			`/items/identitas_barang?fields=id,nama_barang_lengkap,satuan,stok_tersedia,stok_minimum&filter[stok_minimum][_gt]=0&limit=-1`
		),
		// 2. Reservasi SPK aktif
		dget<any>(`/items/stock_reservations?fields=id,spk_id,item_id,quantity&filter[status][_eq]=active&limit=-1`),
		// 3. Pipeline packing yang diminta/disetujui
		dget<any>(
			`/items/project_budgets?fields=id,material_name,qty,unit,packing_status,requested_at&filter[packing_status][_in]=requested,approved&sort=requested_at&limit=-1`
		),
		// 4. Finished Good yang stoknya > 0
		fgCategoryIds.length
			? dget<any>(
					`/items/identitas_barang?fields=id,nama_barang_lengkap,satuan,stok_tersedia,parent_category${fgFilter}&filter[stok_tersedia][_gt]=0&sort=-stok_tersedia&limit=-1`
				)
			: Promise.resolve([])
	]);

	const reorder_alerts = reorderCandidates
		.map((i) => ({
			item_id: i.id,
			nama_barang: i.nama_barang_lengkap,
			satuan: i.satuan,
			stok_tersedia: parseStok(i.stok_tersedia) || 0,
			stok_minimum: Number(i.stok_minimum) || 0
		}))
		.filter((i) => i.stok_minimum > 0 && i.stok_tersedia < i.stok_minimum);

	// Ambil info stok dan nama untuk barang-barang di reservasi SPK
	const resItemIds = [
		...new Set(
			reservations
				.map((r) => (typeof r.item_id === 'object' ? Number(r.item_id?.id) : Number(r.item_id)))
				.filter(Boolean)
		)
	];
	const [resStockRows, resNameMap] = await Promise.all([
		resItemIds.length
			? dget<any>(`/items/identitas_barang?fields=id,stok_tersedia&filter[id][_in]=${resItemIds.join(',')}&limit=-1`)
			: Promise.resolve([]),
		fetchItemNameMap(resItemIds)
	]);
	const resStockMap = new Map<number, number>();
	for (const s of resStockRows) {
		resStockMap.set(Number(s.id), parseStok(s.stok_tersedia) || 0);
	}

	const spk_reservations = reservations.map((r) => {
		const itId = typeof r.item_id === 'object' ? Number(r.item_id?.id) : Number(r.item_id);
		const qty = Number(r.quantity) || 0;
		const stok = itId ? resStockMap.get(itId) ?? null : null;
		return {
			item_id: itId,
			nama_barang: resNameMap.get(itId)?.nama || `Barang #${itId}`,
			satuan: resNameMap.get(itId)?.satuan || '',
			spk_id: r.spk_id,
			quantity: qty,
			stok_tersedia: stok,
			is_cukup: stok != null ? stok >= qty : null
		};
	});

	const packing_pipeline = pipeline.map((r) => ({
		id: r.id,
		material_name: r.material_name || '-',
		qty: Number(r.qty) || 0,
		unit: r.unit || '',
		packing_status: r.packing_status,
		requested_at: r.requested_at || null
	}));

	const finish_good = fgItems.map((i) => ({
		item_id: i.id,
		nama_barang: i.nama_barang_lengkap,
		satuan: i.satuan,
		stok_tersedia: parseStok(i.stok_tersedia) || 0
	}));

	return { reorder_alerts, spk_reservations, packing_pipeline, finish_good };
}

// ============================================================
// Opname — pencarian item + baca stok sistem
// ============================================================

export interface KioskOpnameItemLokasi {
	gudang_id: number;
	nama_rak: string;
	kode_rak: string | null;
	expected_qty?: number;
}

export interface KioskOpnameItem {
	item_id: number;
	nama_barang: string;
	kode_item: string | null;
	satuan: string | null;
	stok_sistem: number;
	stok_minimum?: number | null;
	parent_category?: string | null;
	lokasi_rak?: KioskOpnameItemLokasi[];
}

/** Pisahkan relasi Directus: enrich daftar item dengan lokasi penempatan rak (gudang_item_placement -> gudang). */
export async function attachRackLocationsToOpnameItems(items: KioskOpnameItem[]): Promise<KioskOpnameItem[]> {
	if (!items.length) return items;
	const itemIds = items.map((i) => i.item_id);
	const placements = await dget<any>(
		`/items/gudang_item_placement?filter[identitas_barang_id][_in]=${itemIds.join(',')}&fields=id,gudang_id,identitas_barang_id,expected_qty&limit=-1`
	);
	if (!placements.length) {
		for (const it of items) it.lokasi_rak = [];
		return items;
	}

	const gudangIds = [
		...new Set(
			placements
				.map((p: any) => (typeof p.gudang_id === 'object' ? p.gudang_id?.id : p.gudang_id))
				.filter(Boolean)
				.map(Number)
		)
	];

	const gudangRows = gudangIds.length
		? await dget<any>(
				`/items/gudang?filter[id][_in]=${gudangIds.join(',')}&fields=id,nama_gudang,kode_gudang&limit=-1`
			)
		: [];
	const gudangMap = new Map<number, any>(gudangRows.map((g: any) => [Number(g.id), g]));

	const locsByItem = new Map<number, KioskOpnameItemLokasi[]>();
	for (const p of placements) {
		const iid = Number(typeof p.identitas_barang_id === 'object' ? p.identitas_barang_id?.id : p.identitas_barang_id);
		const gid = Number(typeof p.gudang_id === 'object' ? p.gudang_id?.id : p.gudang_id);
		const g = gudangMap.get(gid);
		if (!locsByItem.has(iid)) locsByItem.set(iid, []);
		locsByItem.get(iid)!.push({
			gudang_id: gid,
			nama_rak: g?.nama_gudang || `Rak #${gid}`,
			kode_rak: g?.kode_gudang || null,
			expected_qty: Number(p.expected_qty) || 0
		});
	}

	for (const it of items) {
		it.lokasi_rak = locsByItem.get(it.item_id) || [];
	}
	return items;
}

/** Ambil rekomendasi item untuk opname saat search box kosong (item aktif / perlu verifikasi berkala). */
export async function getOpnameRecommendations(limit = 12): Promise<KioskOpnameItem[]> {
	const rows = await dget<any>(
		`/items/identitas_barang?fields=id,nama_barang_lengkap,kode_item,satuan,stok_tersedia,stok_minimum,parent_category&sort=-last_stock_update&limit=${limit}`
	);
	const items: KioskOpnameItem[] = rows.map((r: any) => ({
		item_id: r.id,
		nama_barang: r.nama_barang_lengkap,
		kode_item: r.kode_item || null,
		satuan: r.satuan || null,
		stok_sistem: parseStok(r.stok_tersedia) || 0,
		stok_minimum: parseFloat(r.stok_minimum) || null,
		parent_category: r.parent_category || null
	}));
	return attachRackLocationsToOpnameItems(items);
}

/** Ambil daftar item yang ditempatkan pada rak tertentu (dipanggil saat staf scan QR rak EPI:LOC:X). */
export async function getItemsOnRackForOpname(
	gudangId: number
): Promise<{ rack: { id: number; nama_gudang: string; kode_gudang: string | null }; items: KioskOpnameItem[] }> {
	const gRows = await dget<any>(`/items/gudang?filter[id][_eq]=${gudangId}&fields=id,nama_gudang,kode_gudang&limit=1`);
	const rack = gRows[0] || { id: gudangId, nama_gudang: `Rak #${gudangId}`, kode_gudang: null };

	const placements = await dget<any>(
		`/items/gudang_item_placement?filter[gudang_id][_eq]=${gudangId}&fields=id,identitas_barang_id,expected_qty&limit=50`
	);
	if (!placements.length) return { rack, items: [] };

	const itemIds = [
		...new Set(
			placements
				.map((p: any) => (typeof p.identitas_barang_id === 'object' ? p.identitas_barang_id?.id : p.identitas_barang_id))
				.filter(Boolean)
				.map(Number)
		)
	];
	if (!itemIds.length) return { rack, items: [] };

	const itemRows = await dget<any>(
		`/items/identitas_barang?filter[id][_in]=${itemIds.join(',')}&fields=id,nama_barang_lengkap,kode_item,satuan,stok_minimum,parent_category&limit=-1`
	);

	// File 06 §1.1/B4 — dulu stok_sistem di sini adalah stok GLOBAL (identitas_barang.stok_tersedia),
	// bukan saldo rak ini saja. Operator yang menghitung fisik SATU rak dibandingkan dengan stok
	// SEMUA rak barang itu — kalau barang juga ada di rak lain, selisih besar palsu tercipta dan
	// stok rak lain "hilang" begitu supervisor menyetujui. Sekarang pakai ledger per rak.
	const ledger = await fetchLedgerQtyForGudang(gudangId, itemIds);

	const items: KioskOpnameItem[] = itemRows.map((r: any) => ({
		item_id: r.id,
		nama_barang: r.nama_barang_lengkap,
		kode_item: r.kode_item || null,
		satuan: r.satuan || null,
		stok_sistem: ledger.get(r.id) ?? 0,
		stok_minimum: parseFloat(r.stok_minimum) || null,
		parent_category: r.parent_category || null
	}));

	await attachRackLocationsToOpnameItems(items);
	return { rack, items };
}

export async function searchItemsForOpname(q: string, limit = 25): Promise<KioskOpnameItem[]> {
	const term = q.trim();
	if (!term) return [];
	const enc = encodeURIComponent(term);
	let filterQuery = `/items/identitas_barang?filter[_or][0][nama_barang_lengkap][_icontains]=${enc}&filter[_or][1][kode_item][_icontains]=${enc}&filter[_or][2][barcode_vendor][_icontains]=${enc}&filter[_or][3][kode_singkat_item][_icontains]=${enc}&filter[_or][4][id_equipment][_icontains]=${enc}`;
	if (/^\d+$/.test(term)) {
		filterQuery += `&filter[_or][5][id][_eq]=${term}`;
	}
	filterQuery += `&fields=id,nama_barang_lengkap,kode_item,satuan,stok_tersedia,stok_minimum,parent_category&sort=nama_barang_lengkap&limit=${limit}`;

	const rows = await dget<any>(filterQuery);
	const items: KioskOpnameItem[] = rows.map((r: any) => ({
		item_id: r.id,
		nama_barang: r.nama_barang_lengkap,
		kode_item: r.kode_item || null,
		satuan: r.satuan || null,
		stok_sistem: parseStok(r.stok_tersedia) || 0,
		stok_minimum: parseFloat(r.stok_minimum) || null,
		parent_category: r.parent_category || null
	}));

	return attachRackLocationsToOpnameItems(items);
}

// ============================================================
// TULIS — pergerakan stok dari kiosk (pick & opname)
// ============================================================
// Port server-side dari writeStockMovement di stockLapangan.ts. Memakai prefix source
// 'field:' yang SAMA supaya transaksi kiosk muncul di Riwayat Stock Lapangan & (untuk opname
// pending) di inbox /inventory/verifikasi-lapangan yang sudah dipantau supervisor —
// bukan silo terpisah. Penanda '[kiosk #<id>]' + karyawanId disimpan di notes untuk jejak.

const SOURCE_PREFIX = 'field:';

function refNo(): string {
	const d = new Date();
	const yy = String(d.getFullYear()).slice(-2);
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `SL-${yy}${mm}${dd}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
}

export interface WriteMovementArgs {
	itemId: number;
	type: 'IN' | 'OUT';
	quantity: number;
	category: string;
	notes: string;
	karyawanId: number;
	karyawanNama: string;
	clientTxnId: string;
	applyToStock?: boolean;
	referenceType?: string | null;
	referenceId?: number | null;
	fotoFileId?: string | null;
	/** File 06 — rak/zona tempat transaksi ini terjadi. Tanpa ini, saldo per rak
	 *  (fetchLedgerQtyForGudang) tidak pernah berubah walau stok global sudah berkurang. */
	gudangId?: number | null;
}

export interface WriteMovementResult {
	id: number;
	previous_stock: number;
	new_stock: number;
	reference_no: string;
	already_done: boolean;
}

/** Compare-and-swap: PATCH stok_tersedia hanya jika nilainya masih = `expectedRaw` (STRING
 *  mentah, bukan angka hasil parse) saat ini di server. `stok_tersedia` bertipe varchar — data
 *  lama berformat "4.0", "0,25" dsb, dan membandingkan dengan angka (`_eq=4`) tidak akan pernah
 *  cocok dengan teks "4.0" di DB (File 05 §1.1). 0 baris ter-update = ada request lain yang
 *  menang duluan → caller harus baca ulang & retry. Mencegah lost-update dua pick bersamaan. */
async function casPatchStok(itemId: number, expectedRaw: string | null, newStok: number): Promise<boolean> {
	const cond =
		expectedRaw === null || expectedRaw === ''
			? { stok_tersedia: { _null: true } }
			: { stok_tersedia: { _eq: expectedRaw } };
	const res = await directusServerJson<{ data: any[] }>('/items/identitas_barang', {
		method: 'PATCH',
		body: casPatchBody([{ id: { _eq: itemId } }, cond], { stok_tersedia: formatStok(newStok) })
	});
	return Array.isArray(res?.data) && res.data.length > 0;
}

const CAS_MAX_ATTEMPTS = 5;

// File 09 Tahap 2 (29 Sep 2026) — di-export supaya bisa dipakai kiosk/konsumsi/+server.ts untuk
// mencatat "sisa bahan" sebagai transaksi IN biasa (reuse, bukan menduplikasi CAS/kompensasi).
export async function writeStockMovementServer(a: WriteMovementArgs): Promise<WriteMovementResult> {
	// Idempotensi — client_txn_id UNIQUE. dgetStrict (bukan dget): kalau Directus gagal/timeout
	// di sini, JANGAN dianggap "belum ada" (Aturan #1) — itu akan memicu potong stok dua kali
	// pada retry (File 05 §1.2).
	const existing = await dgetStrict<any>(
		`/items/stock_transactions?filter[client_txn_id][_eq]=${encodeURIComponent(a.clientTxnId)}&fields=id,previous_stock,new_stock,reference_no&limit=1`
	);
	if (existing[0]) {
		return {
			id: existing[0].id,
			previous_stock: Number(existing[0].previous_stock) || 0,
			new_stock: Number(existing[0].new_stock) || 0,
			reference_no: existing[0].reference_no,
			already_done: true
		};
	}

	const applyToStock = a.applyToStock !== false;
	const nowIso = new Date().toISOString();

	let previousStock = 0;
	let previousRaw: string | null = null;
	let newStock = 0;
	let attempt = 0;
	let applied = !applyToStock;
	while (!applied) {
		attempt++;
		const itemRows = await dgetStrict<any>(`/items/identitas_barang?filter[id][_eq]=${a.itemId}&fields=id,stok_tersedia&limit=1`);
		const item = itemRows[0];
		if (!item) throw new Error('Barang tidak ditemukan.');
		previousRaw = item.stok_tersedia ?? null;
		previousStock = parseStok(previousRaw);
		newStock = a.type === 'OUT' ? previousStock - a.quantity : previousStock + a.quantity;
		applied = await casPatchStok(a.itemId, previousRaw, newStock);
		if (!applied && attempt >= CAS_MAX_ATTEMPTS) {
			throw new Error('Gagal update stok — terlalu banyak transaksi bersamaan pada barang ini, coba lagi.');
		}
	}
	if (!applyToStock) {
		const itemRows = await dgetStrict<any>(`/items/identitas_barang?filter[id][_eq]=${a.itemId}&fields=id,stok_tersedia&limit=1`);
		const item = itemRows[0];
		if (!item) throw new Error('Barang tidak ditemukan.');
		previousStock = parseStok(item.stok_tersedia);
		newStock = a.type === 'OUT' ? previousStock - a.quantity : previousStock + a.quantity;
	}

	// File 05 §2.5 — kompensasi kalau insert transaksi gagal SETELAH stok sudah di-CAS (mis.
	// timeout/5xx pada langkah ini). Tanpa ini, stok sudah berubah tapi tidak ada jejak
	// stock_transactions, dan operator yang retry akan memotong stok LAGI (potong ganda).
	let tx: any;
	try {
		tx = await directusServerJson<any>('/items/stock_transactions', {
			method: 'POST',
			body: JSON.stringify({
				item_id: a.itemId,
				transaction_type: a.type,
				category_transaction: a.category,
				quantity: a.quantity,
				previous_stock: previousStock,
				new_stock: newStock,
				reference_no: refNo(),
				notes: `${a.notes} [kiosk #${a.karyawanId}]`,
				status: applyToStock ? 'published' : 'draft',
				verification_status: applyToStock ? 'verified' : 'pending',
				verified_at: applyToStock ? nowIso : null,
				transaction_date: nowIso,
				source: `${SOURCE_PREFIX}${a.karyawanNama}`,
				client_txn_id: a.clientTxnId,
				reference_type: a.referenceType ?? null,
				reference_id: a.referenceId ?? null,
				evidence_photo: a.fotoFileId ?? null,
				scan_method: 'kiosk',
				gudang_id: a.gudangId ?? null
			})
		}).then((r) => r?.data ?? r);
	} catch (e) {
		if (applyToStock) {
			const undone = await casPatchStok(a.itemId, formatStok(newStock), previousStock).catch(() => false);
			if (!undone) {
				// Tidak bisa diundo otomatis (stok sudah berubah lagi sejak CAS di atas) —
				// WAJIB terlihat manusia, bukan diam-diam gagal (Aturan #1).
				console.error(
					'[kioskGudang] KRITIS: stok sudah berubah tapi transaksi gagal ditulis & undo gagal',
					{ itemId: a.itemId, previousStock, newStock, clientTxnId: a.clientTxnId }
				);
				await directusServerJson('/items/automation_alerts', {
					method: 'POST',
					body: JSON.stringify({
						source: 'kiosk_stock_write',
						severity: 'critical',
						is_resolved: false,
						message: `Stok barang #${a.itemId} berubah ${previousStock} → ${newStock} tanpa baris stock_transactions (txn ${a.clientTxnId}). Rekonsiliasi manual.`
					})
				}).catch(() => {});
			}
		}
		throw e;
	}

	return {
		id: tx?.id,
		previous_stock: previousStock,
		new_stock: newStock,
		reference_no: tx?.reference_no,
		already_done: false
	};
}

export interface KioskPickInput {
	packing_list_id: number;
	packing_list_item_id: number;
	item_id: number;
	quantity: number;
	client_txn_id: string;
	karyawan_id: number;
	karyawan_nama: string;
	/** File 06 §2.3 — rak asal pengambilan. Tanpa ini, picking mengurangi stok GLOBAL tapi
	 *  saldo per rak (fetchLedgerQtyForGudang) tidak pernah berkurang, sehingga "Cek Stok Rak"
	 *  tetap menunjukkan barang masih ada di rak walau sudah dipicking. Opsional untuk
	 *  kompatibilitas klien lama (cache PWA) — diterima tanpa rak, dicatat warn (Aturan #3). */
	from_rak_id?: number | null;
}

export interface KioskPickResult {
	ok: true;
	already_done: boolean;
	qty_delivered_baru: number;
	reference_no: string;
}

/** CAS `qty_delivered` sebesar `delta` (bisa negatif untuk kompensasi). Sama pola dengan
 *  `casPatchStok`, tapi untuk kolom numerik biasa (bukan varchar).
 *
 *  File 12 (bug ditemukan saat verifikasi akhir, 29 Sep 2026) — `qtyRequired` WAJIB dicek
 *  ULANG di SETIAP percobaan retry, bukan cuma sekali di caller sebelum loop dimulai. Dua
 *  kiosk yang pick item packing-list yang SAMA nyaris bersamaan bisa lolos validasi "sisa"
 *  di caller (keduanya baca snapshot lama), lalu CAS pertama menang dan CAS kedua retry
 *  dengan `current` yang sudah naik — tanpa cek ulang batas ini, retry itu tetap menambah
 *  `delta` penuh dan total `qty_delivered` bisa melebihi `qty_required` (over-delivery).
 *  Kompensasi (delta negatif) TIDAK dibatasi qtyRequired, hanya penambahan (delta positif). */
async function casAdjustQtyDelivered(
	packingListItemId: number,
	currentDelivered: number,
	delta: number,
	qtyRequired?: number
): Promise<number> {
	let attempt = 0;
	let applied = false;
	let current = currentDelivered;
	let next = current;
	while (!applied) {
		attempt++;
		next = Math.max(0, current + delta);
		if (delta > 0 && typeof qtyRequired === 'number' && next > qtyRequired + 0.0001) {
			throw new Error(
				`Qty melebihi sisa yang diminta setelah pick lain masuk duluan (sisa saat ini ${Math.max(0, qtyRequired - current)}). Muat ulang dan coba lagi.`
			);
		}
		const res = await directusServerJson<{ data: any[] }>('/items/packing_list_items', {
			method: 'PATCH',
			body: casPatchBody([{ id: { _eq: packingListItemId } }, { qty_delivered: { _eq: current } }], { qty_delivered: next })
		});
		applied = Array.isArray(res?.data) && res.data.length > 0;
		if (!applied) {
			if (attempt >= CAS_MAX_ATTEMPTS) {
				throw new Error('Gagal update qty_delivered — terlalu banyak pick bersamaan pada item ini, coba lagi.');
			}
			const freshRows = await dgetStrict<any>(
				`/items/packing_list_items?filter[id][_eq]=${packingListItemId}&fields=id,qty_delivered&limit=1`
			);
			current = Number(freshRows[0]?.qty_delivered) || 0;
		}
	}
	return next;
}

/** Submit picking satu item dari antrian kiosk. Aturan sama seperti submitPicking (field):
 *  qty <= sisa (qty_required - qty_delivered dibaca live), idempoten via client_txn_id,
 *  1 baris stock_transactions per submit, update qty_delivered + progress packing_list.
 *
 *  File 05 §2.6 — urutan DIBALIK dari versi lama (stok dulu, baru qty_delivered): kalau
 *  update qty_delivered gagal setelah stok terpotong, retry membalas `already_done` dan
 *  MELEWATI qty_delivered — packing list macet "picking" padahal barang sudah keluar.
 *  Urutan baru: (1) cek idempotensi, (2) CAS qty_delivered DULU, (3) potong stok, (4) kalau
 *  (3) gagal, kompensasi qty_delivered kembali. */
export async function submitPickKiosk(
	input: KioskPickInput
): Promise<KioskPickResult | { ok: false; error: string; status?: number }> {
	if (!(input.quantity > 0)) return { ok: false, error: 'Qty harus lebih dari 0.', status: 400 };

	// (1) Idempotensi — kalau percobaan sebelumnya SUDAH menuntaskan langkah (2)+(3), retry
	// (submit ganda / tombol dobel-tap) harus membalas hasil lama, bukan mengulang keduanya.
	const existingTx = await dgetStrict<any>(
		`/items/stock_transactions?filter[client_txn_id][_eq]=${encodeURIComponent(input.client_txn_id)}&fields=id,reference_no&limit=1`
	);
	if (existingTx[0]) {
		const freshPli = await dgetStrict<any>(
			`/items/packing_list_items?filter[id][_eq]=${input.packing_list_item_id}&fields=qty_delivered&limit=1`
		);
		return {
			ok: true,
			already_done: true,
			qty_delivered_baru: Number(freshPli[0]?.qty_delivered) || 0,
			reference_no: existingTx[0].reference_no
		};
	}

	const itemRows = await dgetStrict<any>(
		`/items/packing_list_items?filter[id][_eq]=${input.packing_list_item_id}&fields=id,qty_required,qty_delivered&limit=1`
	);
	const pli = itemRows[0];
	if (!pli) return { ok: false, error: 'Item packing list tidak ditemukan.', status: 404 };

	const qtyRequired = Number(pli.qty_required) || 0;
	const qtyDeliveredBefore = Number(pli.qty_delivered) || 0;
	const remaining = qtyRequired - qtyDeliveredBefore;
	if (input.quantity > remaining + 0.0001) {
		return { ok: false, error: `Qty melebihi sisa yang diminta (sisa ${remaining}).`, status: 400 };
	}

	// (2) CAS qty_delivered DULU. qtyRequired diteruskan supaya batas "sisa" ditegakkan ULANG
	// di setiap retry CAS, bukan cuma dari snapshot qtyDeliveredBefore di atas (lihat komentar
	// casAdjustQtyDelivered) — mencegah over-delivery saat dua kiosk pick item yang sama bersamaan.
	const qtyDeliveredBaru = await casAdjustQtyDelivered(
		input.packing_list_item_id,
		qtyDeliveredBefore,
		input.quantity,
		qtyRequired
	);

	// (3) Potong stok. Kalau gagal, (4) kompensasi qty_delivered supaya tidak "hilang" (packing
	// list akan terlihat sudah dikirim padahal stok belum berkurang).
	let mv: WriteMovementResult;
	try {
		mv = await writeStockMovementServer({
			itemId: input.item_id,
			type: 'OUT',
			quantity: input.quantity,
			category: 'HQ_PICK_OUT',
			notes: `Picking packing list #${input.packing_list_id} oleh ${input.karyawan_nama}`,
			karyawanId: input.karyawan_id,
			karyawanNama: input.karyawan_nama,
			clientTxnId: input.client_txn_id,
			referenceType: 'PACKING_LIST',
			referenceId: input.packing_list_id,
			gudangId: input.from_rak_id ?? null
		});
	} catch (e) {
		console.error('[kioskGudang] submitPickKiosk gagal, mengompensasi qty_delivered', e);
		await casAdjustQtyDelivered(input.packing_list_item_id, qtyDeliveredBaru, -input.quantity).catch((undoErr) => {
			console.error('[kioskGudang] KRITIS: kompensasi qty_delivered gagal', { packingListItemId: input.packing_list_item_id, undoErr });
		});
		return { ok: false, error: 'Gagal menyimpan ke server. Coba lagi.', status: 502 };
	}

	if (!mv.already_done) {
		await recomputePackingListProgress(input.packing_list_id);
	}

	return { ok: true, already_done: mv.already_done, qty_delivered_baru: qtyDeliveredBaru, reference_no: mv.reference_no };
}

async function recomputePackingListProgress(packingListId: number): Promise<void> {
	const items = await dget<any>(
		`/items/packing_list_items?fields=id,qty_required,qty_delivered&filter[packing_list_id][_eq]=${packingListId}&limit=-1`
	);
	const totalRequired = items.reduce((s, i) => s + (Number(i.qty_required) || 0), 0);
	const totalDelivered = items.reduce((s, i) => s + (Number(i.qty_delivered) || 0), 0);
	const pct = totalRequired > 0 ? Math.min(100, Math.round((totalDelivered / totalRequired) * 100)) : 0;
	const allDelivered =
		items.length > 0 &&
		items.every((i) => (Number(i.qty_delivered) || 0) >= (Number(i.qty_required) || 0) - 0.0001);
	const anyDelivered = items.some((i) => (Number(i.qty_delivered) || 0) > 0);
	const prep_status = allDelivered ? 'packed' : anyDelivered ? 'picking' : 'pending';
	await directusServerJson(`/items/packing_list/${packingListId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			total_qty_required: totalRequired,
			total_qty_delivered: totalDelivered,
			completion_percentage: pct,
			prep_status
		})
	});
}

export interface KioskOpnameInput {
	item_id: number;
	stok_sistem: number;
	hitung_fisik: number;
	catatan: string;
	client_txn_id: string;
	karyawan_id: number;
	karyawan_nama: string;
	/** File 06 §2.1 — rak yang dihitung (opname per rak, desain A). null = opname global/lokasi
	 *  belum dipetakan (desain B, barang tanpa rak). */
	rak_id?: number | null;
}

export interface KioskOpnameResult {
	ok: true;
	status: 'no_change' | 'auto_approved' | 'menunggu_approval';
	delta: number;
	delta_pct: number;
	reference_no?: string;
	already_done?: boolean;
}

/** Opname dari kiosk (scope Gudang Pusat, mirror submitOpnameGudangHq): selisih dalam toleransi
 *  langsung diterapkan; di luar toleransi masuk inbox verifikasi lapangan (stok tak berubah). */
export async function submitOpnameKiosk(
	input: KioskOpnameInput,
	settings: { toleransiPct: number; wajibApproval: boolean }
): Promise<KioskOpnameResult | { ok: false; error: string; status?: number }> {
	const delta = input.hitung_fisik - input.stok_sistem;
	if (delta === 0) return { ok: true, status: 'no_change', delta: 0, delta_pct: 0 };

	const deltaPct = input.stok_sistem > 0 ? (Math.abs(delta) / input.stok_sistem) * 100 : 100;
	const autoApprove = !settings.wajibApproval || deltaPct <= settings.toleransiPct;

	let mv: WriteMovementResult;
	try {
		mv = await writeStockMovementServer({
			itemId: input.item_id,
			type: delta > 0 ? 'IN' : 'OUT',
			quantity: Math.abs(delta),
			category: 'OPNAME_ADJ',
			notes: `Opname kiosk oleh ${input.karyawan_nama}: sistem ${input.stok_sistem} → fisik ${input.hitung_fisik}. ${input.catatan}`.trim(),
			karyawanId: input.karyawan_id,
			karyawanNama: input.karyawan_nama,
			clientTxnId: input.client_txn_id,
			applyToStock: autoApprove,
			gudangId: input.rak_id ?? null
		});
	} catch (e) {
		console.error('[kioskGudang] submitOpnameKiosk gagal', e);
		return { ok: false, error: 'Gagal menyimpan opname. Coba lagi.', status: 502 };
	}

	if (!autoApprove) {
		triggerN8nInventoryAlert({
			type: 'OPNAME_DISCREPANCY',
			title: `Peringatan Selisih Opname Kiosk: Barang #${input.item_id}`,
			detail: {
				item_id: input.item_id,
				stok_sistem: input.stok_sistem,
				hitung_fisik: input.hitung_fisik,
				delta,
				delta_pct: Math.round(deltaPct * 10) / 10,
				catatan: input.catatan,
				karyawan: input.karyawan_nama,
				reference_no: mv.reference_no
			}
		}).catch(() => {});
	}

	return {
		ok: true,
		status: autoApprove ? 'auto_approved' : 'menunggu_approval',
		delta,
		delta_pct: Math.round(deltaPct * 10) / 10,
		reference_no: mv.reference_no,
		already_done: mv.already_done
	};
}
