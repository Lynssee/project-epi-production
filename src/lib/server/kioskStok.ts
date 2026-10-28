// src/lib/server/kioskStok.ts
// SERVER-ONLY. Pembacaan stok rak untuk terminal Kiosk Gudang (badge+PIN, tanpa Firebase).
// Fase 1, rencana "Penajaman Kiosk Inventory — Cek Lokasi Rak & Qty Barang" (8 Sep 2026).
//
// Logika baca di sini adalah PORT server-side dari src/lib/services/cekAreaApi.ts
// (yang butuh sesi Firebase lewat secureDirectusFetch). Kiosk memakai token Directus
// rahasia lewat directusServerJson, jadi TIDAK boleh di-import dari kode klien.
//
// GERBANG: modul ini HANYA membaca. Tidak pernah menulis stock_transactions/stok.

import { directusServerJson } from '$lib/server/directus';
import { triggerN8nInventoryAlert } from '$lib/server/kioskAlert';
import { resolveGateMode } from '$lib/server/gateDefinitionsMode';
import { parseStok } from '$lib/utils/stokFormat';

export interface KioskGudangRow {
	id: number;
	kode_gudang: string | null;
	nama_gudang: string;
	jenis: string | null;
	parent_gudang_id: number | null;
	pic_karyawan_ids: number[] | null;
}

export interface KioskPlacementRow {
	placement_id: number;
	identitas_barang_id: number;
	nama_barang: string;
	kode_item: string | null;
	satuan: string | null;
	kategori: 'fg' | 'rm' | 'lainnya';
	expected_qty: number | null;
	min_qty: number | null;
	ledger_qty: number | null;
}

export interface KioskPicRow {
	id: number;
	nama_karyawan: string;
	no_hp: string | null;
}

export interface KioskDenahContext {
	gambar_id: string;
	nama_denah: string;
	x_pct: number;
	y_pct: number;
}

export interface KategoriConfig {
	fgIds: number[];
	rmIds: number[];
}

/** Baca setelan JSON dari koleksi system_settings (pola sama seperti /api/kiosk/home). */
async function readSetting<T>(key: string, fallback: T): Promise<T> {
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

/**
 * Peta kategori FG/RM. Default FG = parent_category 142,143 (kode yang sudah dipakai
 * berulang di erp-epi-1 inventoryApi.js untuk memfilter Finished Good). RM default kosong
 * -> chip "Raw Material" disembunyikan di UI sampai admin mengisinya lewat
 * system_settings key `kiosk.stok.kategori_rm_ids`.
 */
export async function getKategoriConfig(): Promise<KategoriConfig> {
	const [fgIds, rmIds] = await Promise.all([
		readSetting<number[]>('inventory.kiosk.kategori_fg_ids', null as any).then(
			(val) => val ?? readSetting<number[]>('kiosk.stok.kategori_fg_ids', [142, 143])
		),
		readSetting<number[]>('inventory.kiosk.kategori_rm_ids', null as any).then(
			(val) => val ?? readSetting<number[]>('kiosk.stok.kategori_rm_ids', [])
		)
	]);
	return {
		fgIds: Array.isArray(fgIds) ? fgIds.map(Number).filter(Number.isFinite) : [142, 143],
		rmIds: Array.isArray(rmIds) ? rmIds.map(Number).filter(Number.isFinite) : []
	};
}

function normalizeParentCategory(pc: any): number | null {
	if (pc == null) return null;
	if (typeof pc === 'object') return Number(pc.id) || null;
	const n = Number(pc);
	return Number.isFinite(n) ? n : null;
}

function classify(pcId: number | null, cfg: KategoriConfig): 'fg' | 'rm' | 'lainnya' {
	if (pcId == null) return 'lainnya';
	if (cfg.fgIds.includes(pcId)) return 'fg';
	if (cfg.rmIds.includes(pcId)) return 'rm';
	return 'lainnya';
}

/**
 * Delta satu baris stock_transactions terhadap qty per-rak. Konvensi sama seperti
 * fetchStockByArea di erp-epi-1 inventoryApi.js: kategori yang previous_stock==new_stock
 * (pergerakan antar-lokasi, tidak mengubah stok global) dihitung dari `quantity` dengan
 * tanda sesuai nama kategori; sisanya pakai (new_stock - previous_stock).
 *
 * TRANSFER-RAK-IN / TRANSFER-RAK-OUT = pindah lokasi rak dari Kiosk Gudang (Fase 2,
 * rencana "Penajaman Kiosk Inventory"). Net-nol di stok global, hanya menggeser qty antar rak.
 */
export function ledgerDelta(t: any): number {
	const cat = t.category_transaction || '';
	if (cat === 'TRANSFER-IN-PROYEK' || cat === 'TRANSFER-RAK-IN') return Number(t.quantity) || 0;
	if (cat === 'TRANSFER-RAK-OUT') return -(Number(t.quantity) || 0);
	return (Number(t.new_stock) || 0) - (Number(t.previous_stock) || 0);
}

async function dget<T = any>(path: string): Promise<T[]> {
	try {
		const res = await directusServerJson<{ data: T[] }>(path);
		return res?.data || [];
	} catch (e) {
		console.warn('[kioskStok] gagal fetch', path, e);
		return [];
	}
}

/** File 05 §2.4 — varian `dget` yang MELEMPAR error, dipakai di jalur TULIS (pindahRak). Lihat
 *  penjelasan lengkap di kioskGudang.ts — `dget()` biasa hanya untuk tampilan (read-only). */
async function dgetStrict<T = any>(path: string): Promise<T[]> {
	const res = await directusServerJson<{ data: T[] }>(path);
	return res?.data || [];
}

/**
 * Hitung qty ledger (stok sistem) per item untuk SATU gudang, dari stock_transactions.
 * Persis logika delta di cekAreaApi.fetchAreaDetail: TRANSFER-IN-PROYEK pakai `quantity`,
 * selain itu pakai (new_stock - previous_stock).
 *
 * Optimasi: bila itemIds disertakan, filter stock_transactions HANYA untuk item bersangkutan,
 * menghindari scan limit=-1 pada seluruh riwayat gudang.
 */
export async function fetchLedgerQtyForGudang(gudangId: number, itemIds?: number[]): Promise<Map<number, number>> {
	// File 06 §2.4 — transaksi rejected/pending_approval, dan opname kiosk yang masih menunggu
	// approval (verification_status=pending), TIDAK BOLEH ikut dihitung ke saldo rak. Live:
	// 5.854 transaksi berstatus `draft` (arti "draft" itu sendiri diaudit terpisah — langkah
	// aman: exclude hanya yang JELAS tidak/belum sah, bukan seluruh `draft`).
	let path =
		`/items/stock_transactions?filter[gudang_id][_eq]=${gudangId}` +
		`&filter[status][_nin]=rejected,pending_approval` +
		`&filter[_or][0][verification_status][_null]=true&filter[_or][1][verification_status][_neq]=pending` +
		`&fields=item_id,previous_stock,new_stock,quantity,category_transaction&limit=-1`;
	if (itemIds && itemIds.length > 0) {
		const cleanIds = [...new Set(itemIds.filter((id) => Number.isFinite(id) && id > 0))];
		if (cleanIds.length > 0) {
			path += `&filter[item_id][_in]=${cleanIds.join(',')}`;
		}
	}
	const tx = await dget<any>(path);
	const map = new Map<number, number>();
	for (const t of tx) {
		if (t.item_id == null) continue;
		const iid = typeof t.item_id === 'object' ? Number(t.item_id?.id) : Number(t.item_id);
		map.set(iid, (map.get(iid) || 0) + ledgerDelta(t));
	}
	return map;
}

export interface KioskRakDetail {
	gudang: KioskGudangRow;
	parent_nama: string | null;
	placements: KioskPlacementRow[];
	pics: KioskPicRow[];
	denah: KioskDenahContext | null;
}

/** Detail satu rak untuk kiosk: master rak + item ditempatkan + qty ledger + PIC + denah. */
export async function fetchRakDetail(gudangId: number): Promise<KioskRakDetail | null> {
	let gudang: KioskGudangRow | null = null;
	try {
		const res = await directusServerJson<{ data: KioskGudangRow }>(
			`/items/gudang/${gudangId}?fields=id,kode_gudang,nama_gudang,jenis,parent_gudang_id,pic_karyawan_ids`
		);
		gudang = res?.data || null;
	} catch (e) {
		console.warn('[kioskStok] gagal fetch gudang', gudangId, e);
	}
	if (!gudang) return null;

	const cfg = await getKategoriConfig();

	let parentNama: string | null = null;
	if (gudang.parent_gudang_id) {
		const parents = await dget<any>(
			`/items/gudang?filter[id][_eq]=${gudang.parent_gudang_id}&fields=nama_gudang&limit=1`
		);
		parentNama = parents[0]?.nama_gudang || null;
	}

	const rows = await dget<any>(
		`/items/gudang_item_placement?filter[gudang_id][_eq]=${gudangId}&sort=urutan&limit=-1&fields=id,identitas_barang_id,expected_qty,min_qty`
	);
	const itemIds = [...new Set(rows.map((r) => r.identitas_barang_id).filter(Boolean))];
	const items = itemIds.length
		? await dget<any>(
				`/items/identitas_barang?filter[id][_in]=${itemIds.join(',')}&fields=id,nama_barang_lengkap,kode_item,satuan,parent_category&limit=-1`
			)
		: [];
	const itemMap = new Map(items.map((i: any) => [i.id, i]));
	const ledger = await fetchLedgerQtyForGudang(gudangId, itemIds);

	const placements: KioskPlacementRow[] = rows.map((r) => {
		const it = itemMap.get(r.identitas_barang_id) || {};
		const pcId = normalizeParentCategory(it.parent_category);
		return {
			placement_id: r.id,
			identitas_barang_id: r.identitas_barang_id,
			nama_barang: it.nama_barang_lengkap || `#${r.identitas_barang_id}`,
			kode_item: it.kode_item || null,
			satuan: it.satuan || null,
			kategori: classify(pcId, cfg),
			expected_qty: r.expected_qty ?? null,
			min_qty: r.min_qty ?? null,
			ledger_qty: ledger.has(r.identitas_barang_id) ? ledger.get(r.identitas_barang_id)! : null
		};
	});

	let pics: KioskPicRow[] = [];
	if (gudang.pic_karyawan_ids?.length) {
		pics = await dget<any>(
			`/items/karyawan?filter[id][_in]=${gudang.pic_karyawan_ids.join(',')}&fields=id,nama_karyawan,no_hp&limit=-1`
		);
	}

	let denah: KioskDenahContext | null = null;
	const pins = await dget<any>(
		`/items/ga_denah_pin?filter[gudang_id][_eq]=${gudangId}&limit=1&fields=denah_id,x_pct,y_pct`
	);
	if (pins.length) {
		const denahRows = await dget<any>(
			`/items/ga_denah?filter[id][_eq]=${pins[0].denah_id}&limit=1&fields=id,nama,gambar`
		);
		const d = denahRows[0];
		if (d?.gambar) {
			denah = { gambar_id: d.gambar, nama_denah: d.nama, x_pct: pins[0].x_pct, y_pct: pins[0].y_pct };
		}
	}

	return { gudang, parent_nama: parentNama, placements, pics, denah };
}

export interface KioskCariHit {
	identitas_barang_id: number;
	nama_barang: string;
	kode_item: string | null;
	satuan: string | null;
	kategori: 'fg' | 'rm' | 'lainnya';
	gudang_id: number;
	rak_nama: string;
	rak_kode: string | null;
	parent_nama: string | null;
	expected_qty: number | null;
	ledger_qty: number | null;
}

/**
 * Cari barang lintas rak: "barang X ada di rak mana saja + qty berapa".
 * q dicocokkan ke nama_barang_lengkap ATAU kode_item (icontains).
 */
export async function cariBarangLintasRak(q: string, limitItems = 25): Promise<KioskCariHit[]> {
	const term = q.trim();
	if (term.length < 2) return [];
	const cfg = await getKategoriConfig();
	const enc = encodeURIComponent(term);

	const items = await dget<any>(
		`/items/identitas_barang?filter[_or][0][nama_barang_lengkap][_icontains]=${enc}` +
			`&filter[_or][1][kode_item][_icontains]=${enc}` +
			`&fields=id,nama_barang_lengkap,kode_item,satuan,parent_category&limit=${limitItems}`
	);
	if (!items.length) return [];
	const itemMap = new Map(items.map((i: any) => [i.id, i]));
	const itemIds = items.map((i: any) => i.id);

	const placements = await dget<any>(
		`/items/gudang_item_placement?filter[identitas_barang_id][_in]=${itemIds.join(',')}` +
			`&fields=id,gudang_id,identitas_barang_id,expected_qty&limit=-1`
	);
	if (!placements.length) return [];

	const gudangIds = [...new Set(placements.map((p) => p.gudang_id).filter(Boolean))];
	const gudangRows = gudangIds.length
		? await dget<any>(
				`/items/gudang?filter[id][_in]=${gudangIds.join(',')}&fields=id,nama_gudang,kode_gudang,parent_gudang_id&limit=-1`
			)
		: [];
	const gudangMap = new Map(gudangRows.map((g: any) => [g.id, g]));
	const parentIds = [...new Set(gudangRows.map((g: any) => g.parent_gudang_id).filter(Boolean))];
	const parentRows = parentIds.length
		? await dget<any>(`/items/gudang?filter[id][_in]=${parentIds.join(',')}&fields=id,nama_gudang&limit=-1`)
		: [];
	const parentMap = new Map(parentRows.map((g: any) => [g.id, g.nama_gudang]));

	// Qty ledger per (gudang, item) — satu query terpadu khusus itemIds dan gudangIds yang bersangkutan
	const ledgerByGudang = new Map<number, Map<number, number>>();
	for (const gid of gudangIds) {
		ledgerByGudang.set(gid, new Map<number, number>());
	}
	if (gudangIds.length > 0 && itemIds.length > 0) {
		const tx = await dget<any>(
			`/items/stock_transactions?filter[gudang_id][_in]=${gudangIds.join(',')}&filter[item_id][_in]=${itemIds.join(',')}&fields=gudang_id,item_id,previous_stock,new_stock,quantity,category_transaction&limit=-1`
		);
		for (const t of tx) {
			if (t.item_id == null || t.gudang_id == null) continue;
			const gid = Number(typeof t.gudang_id === 'object' ? t.gudang_id?.id : t.gudang_id);
			const iid = Number(typeof t.item_id === 'object' ? t.item_id?.id : t.item_id);
			const gMap = ledgerByGudang.get(gid);
			if (gMap) {
				gMap.set(iid, (gMap.get(iid) || 0) + ledgerDelta(t));
			}
		}
	}

	const hits: KioskCariHit[] = placements.map((p) => {
		const g = gudangMap.get(p.gudang_id) || {};
		const it = itemMap.get(p.identitas_barang_id) || {};
		const pcId = normalizeParentCategory(it.parent_category);
		const ledger = ledgerByGudang.get(p.gudang_id);
		return {
			identitas_barang_id: p.identitas_barang_id,
			nama_barang: it.nama_barang_lengkap || `#${p.identitas_barang_id}`,
			kode_item: it.kode_item || null,
			satuan: it.satuan || null,
			kategori: classify(pcId, cfg),
			gudang_id: p.gudang_id,
			rak_nama: g.nama_gudang || `#${p.gudang_id}`,
			rak_kode: g.kode_gudang || null,
			parent_nama: g.parent_gudang_id ? parentMap.get(g.parent_gudang_id) || null : null,
			expected_qty: p.expected_qty ?? null,
			ledger_qty: ledger?.has(p.identitas_barang_id) ? ledger.get(p.identitas_barang_id)! : null
		};
	});

	// Rak dengan stok/isi lebih dulu, lalu nama barang.
	hits.sort((a, b) => {
		const av = (b.ledger_qty ?? -1) - (a.ledger_qty ?? -1);
		if (av !== 0) return av;
		return a.nama_barang.localeCompare(b.nama_barang);
	});
	return hits;
}

// ============================================================
// Fase 2 — Pindah Lokasi Rak dari Kiosk Gudang
// ============================================================
// Keputusan user (8 Sep 2026): eksekusi LANGSUNG (atribusi badge, bukan approval SPV),
// placement rak tujuan DIBUAT + expected_qty ikut pindah. Ini BUKAN pengeluaran barang —
// stok global (identitas_barang.stok_tersedia) TIDAK berubah, hanya qty antar rak bergeser.
// Model transaksi mengikuti pola TRANSFER-*-PROYEK di erp-epi-1: 2 baris stock_transactions
// (OUT rak asal + IN rak tujuan), previous_stock == new_stock (delta global nol), qty per-rak
// dihitung dari `quantity` lewat ledgerDelta().

export interface PindahRakInput {
	item_id: number;
	rak_asal_id: number;
	rak_tujuan_id: number;
	qty: number;
	client_txn_id: string;
	karyawan_id: number;
	karyawan_nama: string;
	catatan?: string | null;
	foto_file_id?: string | null;
}

export interface PindahRakResult {
	ok: true;
	out_txn_id: number;
	in_txn_id: number;
	reference_no: string;
	rak_asal_sisa_ledger: number;
	rak_tujuan_ledger_baru: number;
	flag_selisih: boolean;
	pending_approval?: boolean;
	already_done?: boolean;
}

function makeReferenceNo(): string {
	const d = new Date();
	const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
	return `TRF-RAK-${stamp}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

/**
 * Pindahkan `qty` unit `item_id` dari rak asal ke rak tujuan.
 * Aturan:
 *  - rak asal != rak tujuan, keduanya harus punya parent (rak/zona, bukan gudang teratas)
 *    dan berada di parent (fasilitas) yang SAMA — pindah antar-fasilitas lewat jalur SJ resmi.
 *  - qty > 0. Kalau qty > qty ledger rak asal: TIDAK diblokir (CLAUDE.md #6), tapi ditandai
 *    flag_selisih untuk ditindaklanjuti opname.
 *  - idempoten: client_txn_id "<base>" -> baris OUT pakai "<base>:out", IN pakai "<base>:in".
 */
export async function pindahRak(input: PindahRakInput): Promise<PindahRakResult | { ok: false; error: string; status?: number }> {
	const { item_id, rak_asal_id, rak_tujuan_id, qty } = input;
	if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: 'Qty harus lebih dari 0.', status: 400 };
	if (rak_asal_id === rak_tujuan_id) return { ok: false, error: 'Rak tujuan sama dengan rak asal.', status: 400 };

	// Idempotensi — kalau baris OUT/IN dgn client_txn_id ini sudah ada, kembalikan hasil lama.
	// File 05 §2.4: dgetStrict (bukan dget) — di jalur tulis, kegagalan Directus TIDAK BOLEH
	// dianggap "belum ada" (bisa memicu tulis ganda pada retry).
	const outKey = `${input.client_txn_id}:out`;
	const inKey = `${input.client_txn_id}:in`;
	const existing = await dgetStrict<any>(
		`/items/stock_transactions?filter[client_txn_id][_in]=${encodeURIComponent(outKey)},${encodeURIComponent(inKey)}&fields=id,client_txn_id,reference_no&limit=2`
	);
	if (existing.length >= 2) {
		const out = existing.find((r) => r.client_txn_id === outKey);
		const inn = existing.find((r) => r.client_txn_id === inKey);
		const ledgerAsal = await fetchLedgerQtyForGudang(rak_asal_id, [item_id]);
		const ledgerTujuan = await fetchLedgerQtyForGudang(rak_tujuan_id, [item_id]);
		return {
			ok: true,
			out_txn_id: out?.id,
			in_txn_id: inn?.id,
			reference_no: out?.reference_no || inn?.reference_no || '',
			rak_asal_sisa_ledger: ledgerAsal.get(item_id) ?? 0,
			rak_tujuan_ledger_baru: ledgerTujuan.get(item_id) ?? 0,
			flag_selisih: false,
			already_done: true
		};
	}
	// Data LAMA (sebelum File 05) yang telanjur setengah jadi karena dua POST terpisah — tulis
	// HANYA baris yang hilang, jangan diulang dari nol. Sejak fix ini (POST array satu transaksi
	// DB), kasus ini seharusnya tidak terjadi lagi untuk transaksi baru.
	const existingOut = existing.find((r) => r.client_txn_id === outKey);
	const existingIn = existing.find((r) => r.client_txn_id === inKey);
	if (existingOut || existingIn) {
		console.warn('[kioskStok] pindahRak: menemukan baris setengah jadi (data lama), menulis sisanya', {
			clientTxnId: input.client_txn_id,
			punyaOut: Boolean(existingOut),
			punyaIn: Boolean(existingIn)
		});
	}

	// Validasi rak.
	const [asalRows, tujuanRows] = await Promise.all([
		dgetStrict<any>(`/items/gudang?filter[id][_eq]=${rak_asal_id}&fields=id,nama_gudang,parent_gudang_id&limit=1`),
		dgetStrict<any>(`/items/gudang?filter[id][_eq]=${rak_tujuan_id}&fields=id,nama_gudang,parent_gudang_id&limit=1`)
	]);
	const asal = asalRows[0];
	const tujuan = tujuanRows[0];
	if (!asal) return { ok: false, error: 'Rak asal tidak ditemukan.', status: 404 };
	if (!tujuan) return { ok: false, error: 'Rak tujuan tidak ditemukan.', status: 404 };
	if (!asal.parent_gudang_id || !tujuan.parent_gudang_id)
		return { ok: false, error: 'Pindah rak hanya untuk rak/zona di dalam gudang, bukan gudang level teratas.', status: 400 };
	if (asal.parent_gudang_id !== tujuan.parent_gudang_id)
		return {
			ok: false,
			error: 'Rak tujuan ada di fasilitas berbeda. Pindah antar-fasilitas harus lewat Surat Jalan, bukan dari sini.',
			status: 400
		};

	// Item + stok global (dipakai apa adanya untuk previous_stock == new_stock). parseStok
	// (bukan Number langsung) — stok_tersedia varchar bisa berformat koma desimal data lama.
	const itemRows = await dgetStrict<any>(
		`/items/identitas_barang?filter[id][_eq]=${item_id}&fields=id,nama_barang_lengkap,stok_tersedia,satuan&limit=1`
	);
	const item = itemRows[0];
	if (!item) return { ok: false, error: 'Barang tidak ditemukan.', status: 404 };
	const stokGlobal = parseStok(item.stok_tersedia);

	const ledgerAsalBefore = await fetchLedgerQtyForGudang(rak_asal_id, [item_id]);
	const qtyAsalBefore = ledgerAsalBefore.get(item_id) ?? 0;
	const flagSelisih = qty > qtyAsalBefore + 0.0001;

	const referenceNo = makeReferenceNo();
	const nowIso = new Date().toISOString();
	const src = `kiosk:pindah-rak:${input.karyawan_nama} (#${input.karyawan_id})`;
	const baseNote = (input.catatan ? `${input.catatan} — ` : '') +
		`Pindah rak ${asal.nama_gudang} → ${tujuan.nama_gudang} oleh ${input.karyawan_nama} (karyawan #${input.karyawan_id})` +
		(flagSelisih ? ` [SELISIH: qty ${qty} > tercatat di rak asal ${qtyAsalBefore}]` : '');

	// Evaluasi Gate G_INV_RAK_TRANSFER_APPROVAL (Fase 2 Lifecycle Inventory)
	// Mode dibaca dari gate_enforcement / gate_definitions (dapat diatur superadmin di UI)
	const gateMode = await resolveGateMode('G_INV_RAK_TRANSFER_APPROVAL', 'inventory_transfer').catch(() => 'soft');
	let requiresApproval = false;

	if (gateMode === 'hard') {
		requiresApproval = true;
	} else if (gateMode === 'soft') {
		// Mode soft: hanya butuh approval jika terjadi selisih fisik vs buku
		if (flagSelisih) {
			requiresApproval = true;
		}
	}

	const commonFields = {
		item_id,
		quantity: qty,
		previous_stock: stokGlobal,
		new_stock: stokGlobal, // net-nol di stok global — hanya geser antar rak
		reference_no: referenceNo,
		status: requiresApproval ? 'draft' : 'published',
		verification_status: requiresApproval ? 'pending' : 'verified',
		verified_at: requiresApproval ? null : nowIso,
		transaction_date: nowIso,
		source: src,
		reference_type: 'PINDAH_RAK',
		evidence_photo: input.foto_file_id ?? null,
		notes: baseNote + (requiresApproval ? ' [MENUNGGU_APPROVAL_KEPALA_GUDANG]' : '')
	};

	const outPayload = {
		...commonFields,
		transaction_type: 'OUT',
		category_transaction: 'TRANSFER-RAK-OUT',
		gudang_id: rak_asal_id,
		destination_type: 'gudang',
		destination_id: rak_tujuan_id,
		destination_name: tujuan.nama_gudang,
		client_txn_id: outKey
	};
	const inPayload = {
		...commonFields,
		transaction_type: 'IN',
		category_transaction: 'TRANSFER-RAK-IN',
		gudang_id: rak_tujuan_id,
		destination_type: 'gudang',
		destination_id: rak_asal_id,
		destination_name: asal.nama_gudang,
		client_txn_id: inKey
	};

	let outTxn: any;
	let inTxn: any;
	try {
		if (existingOut && !existingIn) {
			// Data lama setengah jadi: baris OUT sudah ada, tulis IN saja.
			outTxn = existingOut;
			inTxn = await directusServerJson<any>('/items/stock_transactions', { method: 'POST', body: JSON.stringify(inPayload) }).then(
				(r) => r?.data ?? r
			);
		} else if (existingIn && !existingOut) {
			inTxn = existingIn;
			outTxn = await directusServerJson<any>('/items/stock_transactions', { method: 'POST', body: JSON.stringify(outPayload) }).then(
				(r) => r?.data ?? r
			);
		} else {
			// File 05 §2.7 — SATU POST berisi array. Directus membuat kedua baris dalam SATU
			// transaksi database: kalau salah satu gagal (mis. constraint unik client_txn_id),
			// baris yang lain ikut dibatalkan — tidak ada lagi kondisi "OUT tersimpan, IN gagal".
			const created = await directusServerJson<any>('/items/stock_transactions', {
				method: 'POST',
				body: JSON.stringify([outPayload, inPayload])
			}).then((r) => r?.data ?? r);
			[outTxn, inTxn] = Array.isArray(created) ? created : [created, null];
		}
	} catch (e: any) {
		console.error('[kioskStok] pindahRak gagal menulis stock_transactions', e);
		return { ok: false, error: 'Gagal menyimpan pergerakan stok. Coba lagi.', status: 502 };
	}

	// Geser rencana penempatan (gudang_item_placement):
	// Hanya langsung digeser jika TIDAK memerlukan approval. Jika butuh approval,
	// pergeseran placement akan dieksekusi oleh Kepala Gudang saat menyetujui transaksi.
	if (!requiresApproval) {
		try {
			await shiftPlacementExpected(rak_asal_id, rak_tujuan_id, item_id, qty);
		} catch (e) {
			// Non-fatal: transaksi stok sudah tercatat (sumber kebenaran). Placement bisa
			// diselaraskan admin lewat Master Gudang. Jangan gagalkan operasi lapangan.
			console.warn('[kioskStok] pindahRak: gagal menggeser placement (non-fatal)', e);
		}
	}
	// Baris placement rak tujuan bisa baru dibuat -> placement utama (cache lokasi) bisa berubah.
	await refreshLokasiCache([item_id]);

	const ledgerTujuanAfter = await fetchLedgerQtyForGudang(rak_tujuan_id, [item_id]);

	if (requiresApproval) {
		triggerN8nInventoryAlert({
			type: 'TRANSFER_SHORTAGE',
			title: `Permintaan Approval Pindah Rak: ${item.nama_barang_lengkap}`,
			detail: {
				item_id,
				nama_barang: item.nama_barang_lengkap,
				rak_asal: asal.nama_gudang,
				rak_tujuan: tujuan.nama_gudang,
				qty_dipindah: qty,
				qty_tercatat: qtyAsalBefore,
				karyawan: input.karyawan_nama,
				reference_no: referenceNo,
				status: 'pending_approval'
			}
		}).catch(() => {});
	} else if (flagSelisih) {
		triggerN8nInventoryAlert({
			type: 'TRANSFER_SHORTAGE',
			title: `Peringatan Selisih Pindah Rak: ${item.nama_barang_lengkap}`,
			detail: {
				item_id,
				nama_barang: item.nama_barang_lengkap,
				rak_asal: asal.nama_gudang,
				rak_tujuan: tujuan.nama_gudang,
				qty_dipindah: qty,
				qty_tercatat: qtyAsalBefore,
				karyawan: input.karyawan_nama,
				reference_no: referenceNo
			}
		}).catch(() => {});
	}

	return {
		ok: true,
		pending_approval: requiresApproval,
		out_txn_id: outTxn?.id,
		in_txn_id: inTxn?.id,
		reference_no: referenceNo,
		rak_asal_sisa_ledger: requiresApproval ? qtyAsalBefore : qtyAsalBefore - qty,
		rak_tujuan_ledger_baru: requiresApproval ? (ledgerTujuanAfter.get(item_id) ?? 0) : (ledgerTujuanAfter.get(item_id) ?? qty),
		flag_selisih: flagSelisih
	};
}

// ============================================================
// Fase 4 — Peta Gudang di Kiosk (denah gambar + pin, plus tree-view fallback)
// ============================================================

export interface KioskPetaPin {
	pin_id: number;
	gudang_id: number;
	gudang_nama: string;
	gudang_kode: string | null;
	x_pct: number;
	y_pct: number;
	label: string | null;
	status_verifikasi: 'match' | 'selisih' | 'mismatch' | null;
}

export interface KioskPetaDenah {
	id: number;
	nama: string;
	gambar_id: string;
	pins: KioskPetaPin[];
}

export interface KioskPetaTreeNode {
	id: number;
	nama_gudang: string;
	kode_gudang: string | null;
	jenis: string | null;
	parent_gudang_id: number | null;
}

export interface KioskPeta {
	denah: KioskPetaDenah[];
	tree: KioskPetaTreeNode[];
}

export async function fetchPetaKiosk(): Promise<KioskPeta> {
	const [denahRows, pinRows, treeRows] = await Promise.all([
		dget<any>(`/items/ga_denah?fields=id,nama,gambar,sort_order&sort=sort_order&limit=-1`),
		dget<any>(
			`/items/ga_denah_pin?fields=id,denah_id,gudang_id,x_pct,y_pct,label&filter[gudang_id][_nnull]=true&sort=sort_order&limit=-1`
		),
		dget<any>(
			`/items/gudang?fields=id,nama_gudang,kode_gudang,jenis,parent_gudang_id&sort=nama_gudang&limit=-1`
		)
	]);

	const pinGudangIds = [
		...new Set(
			pinRows
				.map((p) => (typeof p.gudang_id === 'object' ? Number(p.gudang_id?.id) : Number(p.gudang_id)))
				.filter((id) => Number.isFinite(id) && id > 0)
		)
	];
	const [gudangRows, verifRows] = await Promise.all([
		pinGudangIds.length
			? dget<any>(`/items/gudang?filter[id][_in]=${pinGudangIds.join(',')}&fields=id,nama_gudang,kode_gudang&limit=-1`)
			: Promise.resolve([]),
		pinGudangIds.length
			? dget<any>(
					`/items/gudang_verifikasi?filter[gudang_id][_in]=${pinGudangIds.join(',')}&fields=gudang_id,status,date_created&sort=-date_created&limit=-1`
				)
			: Promise.resolve([])
	]);
	const gudangMap = new Map(gudangRows.map((g: any) => [Number(g.id), g]));
	const verifMap = new Map<number, string>();
	for (const v of verifRows) {
		const gId = typeof v.gudang_id === 'object' ? Number(v.gudang_id?.id) : Number(v.gudang_id);
		if (gId && !verifMap.has(gId)) verifMap.set(gId, v.status);
	}

	const pinsByDenah = new Map<number, KioskPetaPin[]>();
	for (const p of pinRows) {
		const gId = typeof p.gudang_id === 'object' ? Number(p.gudang_id?.id) : Number(p.gudang_id);
		const dId = typeof p.denah_id === 'object' ? Number(p.denah_id?.id) : Number(p.denah_id);
		if (!gId || !dId) continue;
		const g = gudangMap.get(gId) || {};
		const s = verifMap.get(gId);
		const pin: KioskPetaPin = {
			pin_id: p.id,
			gudang_id: gId,
			gudang_nama: g.nama_gudang || `#${gId}`,
			gudang_kode: g.kode_gudang || null,
			x_pct: Number(p.x_pct) || 0,
			y_pct: Number(p.y_pct) || 0,
			label: p.label || null,
			status_verifikasi: s === 'match' || s === 'selisih' || s === 'mismatch' ? s : null
		};
		if (!pinsByDenah.has(dId)) pinsByDenah.set(dId, []);
		pinsByDenah.get(dId)!.push(pin);
	}

	const denah: KioskPetaDenah[] = denahRows
		.filter((d) => d.gambar)
		.map((d) => ({
			id: d.id,
			nama: d.nama || `Denah #${d.id}`,
			gambar_id: d.gambar,
			pins: pinsByDenah.get(d.id) || []
		}));

	const tree: KioskPetaTreeNode[] = treeRows.map((g) => ({
		id: g.id,
		nama_gudang: g.nama_gudang,
		kode_gudang: g.kode_gudang || null,
		jenis: g.jenis || null,
		parent_gudang_id: g.parent_gudang_id ?? null
	}));

	return { denah, tree };
}

// ============================================================
// Kelola Rak dari Kiosk Gudang — tambah / hapus / pindah PENEMPATAN item (kerapian rak)
// ============================================================
// Yang diubah di sini HANYA master penempatan (gudang_item_placement) — peta "item X tinggal
// di rak Y". TIDAK pernah menulis stock_transactions/stok. Pergeseran qty tetap lewat pindahRak.
// Aturan pengaman:
//  - Hapus / pindah-lokasi-saja diblokir kalau rak ini masih mencatat stok > 0 untuk item tsb
//    (stok jadi "yatim" tanpa penempatan). Operator diarahkan memindah qty dulu.
//  - Rak tujuan/rak target wajib punya parent (bukan gudang teratas) dan, untuk pindah, di
//    fasilitas yang SAMA — konsisten dengan pindahRak.
//  - Setiap aksi dicatat ke scan_log (ref_collection=gudang_item_placement, source=kiosk)
//    supaya admin bisa melacak siapa merapikan apa (token server tidak membawa identitas badge).

export interface KelolaRakActor {
	karyawan_id: number;
	karyawan_nama: string;
}

type KelolaFail = { ok: false; error: string; status: number };

export interface KioskBarangUntukRak {
	identitas_barang_id: number;
	nama_barang: string;
	kode_item: string | null;
	satuan: string | null;
	kategori: 'fg' | 'rm' | 'lainnya';
	sudah_di_rak: boolean;
	rak_lain: string[];
}

async function auditPlacement(
	actor: KelolaRakActor,
	refId: number | string,
	aksi: 'TAMBAH' | 'HAPUS' | 'PINDAH',
	notes: string,
	stageFrom: string | null,
	stageTo: string | null
): Promise<void> {
	await directusServerJson('/items/scan_log', {
		method: 'POST',
		body: JSON.stringify({
			ref_collection: 'gudang_item_placement',
			ref_id: String(refId),
			actor_id: actor.karyawan_id,
			actor_role: 'kiosk_gudang',
			timestamp: new Date().toISOString(),
			source: 'kiosk',
			stage_from: stageFrom,
			stage_to: stageTo,
			notes: `[KELOLA-RAK:${aksi}] ${notes} — oleh ${actor.karyawan_nama} (#${actor.karyawan_id})`
		})
	}).catch((e) => console.warn('[kioskStok] gagal mencatat audit kelola rak (non-fatal)', e));
}

// ── Cache identitas_barang.lokasi ────────────────────────────────────────────
// gudang_item_placement = sumber kebenaran lokasi; identitas_barang.lokasi = CACHE 1-nilai
// yang masih dibaca form/filter lama di dashboard admin. CERMIN PERSIS dari
// refreshLokasiCache() + fetchInternalGudangNodes() di erp-epi src/lib/services/
// lokasiPlacementApi.js — JANGAN ubah rumus di satu sisi saja:
//   nilai = NAMA node placement UTAMA (is_active, urutan terkecil lalu id terkecil), HURUF
//   BESAR; node gudang nonaktif / berantai proyek dianggap tidak ada -> null.

const GUDANG_NODE_TTL_MS = 5 * 60 * 1000;
let gudangNodeCache: { at: number; byId: Map<number, any> } | null = null;

async function internalGudangNamaMap(): Promise<Map<number, string>> {
	if (!gudangNodeCache || Date.now() - gudangNodeCache.at > GUDANG_NODE_TTL_MS) {
		const rows = await dgetStrict<any>(
			'/items/gudang?limit=-1&fields=id,kode_gudang,nama_gudang,jenis,parent_gudang_id,is_active'
		);
		gudangNodeCache = { at: Date.now(), byId: new Map(rows.map((r) => [Number(r.id), r])) };
	}
	const byId = gudangNodeCache.byId;
	const isProyekChain = (row: any) => {
		let cur = row;
		let guard = 0;
		while (cur && guard++ < 12) {
			if (cur.jenis === 'proyek' || cur.jenis === 'lokasi_lapangan') return true;
			if ((cur.kode_gudang || '').toUpperCase().startsWith('PROY-')) return true;
			cur = cur.parent_gudang_id ? byId.get(Number(cur.parent_gudang_id)) : null;
		}
		return false;
	};
	const out = new Map<number, string>();
	for (const [id, r] of byId) {
		if (r.is_active !== false && !isProyekChain(r)) out.set(id, r.nama_gudang);
	}
	return out;
}

/**
 * Hitung ulang identitas_barang.lokasi untuk item-item yang penempatannya baru diubah kiosk.
 * Hemat call: 1 GET placement untuk semua item + 1 PATCH batch (node gudang di-cache 5 menit).
 * Non-fatal — perubahan penempatan sudah tersimpan; kegagalan cache hanya di-log.
 */
async function refreshLokasiCache(itemIds: number[]): Promise<void> {
	const ids = [...new Set(itemIds.filter((id) => Number.isFinite(id) && id > 0))];
	if (!ids.length) return;
	try {
		const [rows, namaNode] = await Promise.all([
			dgetStrict<any>(
				`/items/gudang_item_placement?limit=-1&filter[identitas_barang_id][_in]=${ids.join(',')}` +
					`&filter[is_active][_eq]=true&fields=id,identitas_barang_id,gudang_id,urutan&sort=urutan,id`
			),
			internalGudangNamaMap()
		]);
		// rows sudah urut (urutan, id) -> baris pertama per item = placement utama.
		const utama = new Map<number, number>();
		for (const r of rows) {
			const iid = Number(r.identitas_barang_id);
			if (!utama.has(iid)) utama.set(iid, Number(r.gudang_id));
		}
		const payload = ids.map((id) => {
			const gid = utama.get(id);
			const nama = gid != null ? (namaNode.get(gid) || '').toString().trim().toUpperCase() : '';
			return { id, lokasi: nama || null };
		});
		await directusServerJson('/items/identitas_barang', { method: 'PATCH', body: JSON.stringify(payload) });
	} catch (e) {
		console.warn('[kioskStok] gagal sinkron cache identitas_barang.lokasi (non-fatal)', ids, e);
	}
}

async function getRakForKelola(gudangId: number) {
	const rows = await dgetStrict<any>(
		`/items/gudang?filter[id][_eq]=${gudangId}&fields=id,nama_gudang,parent_gudang_id&limit=1`
	);
	return rows[0] || null;
}

/** Cari barang master (identitas_barang) untuk ditambahkan ke satu rak. */
export async function cariBarangUntukRak(q: string, gudangId: number, limitItems = 25): Promise<KioskBarangUntukRak[]> {
	const term = q.trim();
	if (term.length < 2) return [];
	const cfg = await getKategoriConfig();
	const enc = encodeURIComponent(term);
	const items = await dget<any>(
		`/items/identitas_barang?filter[_or][0][nama_barang_lengkap][_icontains]=${enc}` +
			`&filter[_or][1][kode_item][_icontains]=${enc}` +
			`&fields=id,nama_barang_lengkap,kode_item,satuan,parent_category&sort=nama_barang_lengkap&limit=${limitItems}`
	);
	if (!items.length) return [];

	const ids = items.map((i: any) => i.id);
	const placements = await dget<any>(
		`/items/gudang_item_placement?filter[identitas_barang_id][_in]=${ids.join(',')}&fields=gudang_id,identitas_barang_id&limit=-1`
	);
	const gudangIds = [...new Set(placements.map((p) => Number(p.gudang_id)).filter((id) => id && id !== gudangId))];
	const gudangRows = gudangIds.length
		? await dget<any>(`/items/gudang?filter[id][_in]=${gudangIds.join(',')}&fields=id,nama_gudang&limit=-1`)
		: [];
	const namaRak = new Map(gudangRows.map((g: any) => [Number(g.id), g.nama_gudang as string]));

	return items.map((it: any) => {
		const mine = placements.filter((p) => Number(p.identitas_barang_id) === it.id);
		return {
			identitas_barang_id: it.id,
			nama_barang: it.nama_barang_lengkap || `#${it.id}`,
			kode_item: it.kode_item || null,
			satuan: it.satuan || null,
			kategori: classify(normalizeParentCategory(it.parent_category), cfg),
			sudah_di_rak: mine.some((p) => Number(p.gudang_id) === gudangId),
			rak_lain: mine
				.filter((p) => Number(p.gudang_id) !== gudangId)
				.map((p) => namaRak.get(Number(p.gudang_id)) || `#${p.gudang_id}`)
		};
	});
}

export const TAMBAH_PLACEMENT_MAX = 50;

/**
 * Tempatkan satu/banyak item master ke rak (buat baris gudang_item_placement). Item yang sudah
 * ada di rak ini / tidak ditemukan DILEWATI (bukan menggagalkan seluruh batch) dan dilaporkan
 * balik. Semua baris baru dibuat dalam SATU POST array = satu transaksi DB Directus.
 */
export async function tambahPlacement(input: {
	gudang_id: number;
	items: { item_id: number; expected_qty: number | null }[];
	actor: KelolaRakActor;
}): Promise<
	| { ok: true; ditambahkan: { item_id: number; placement_id: number; nama: string }[]; dilewati: { item_id: number; nama: string; alasan: string }[] }
	| KelolaFail
> {
	const { gudang_id, actor } = input;
	// Dedup item_id di dalam request (baris terakhir menang).
	const byId = new Map<number, number | null>();
	for (const it of input.items) byId.set(it.item_id, it.expected_qty);
	if (byId.size === 0) return { ok: false, error: 'Pilih minimal satu barang.', status: 400 };
	if (byId.size > TAMBAH_PLACEMENT_MAX)
		return { ok: false, error: `Maksimal ${TAMBAH_PLACEMENT_MAX} barang sekali tambah.`, status: 400 };
	for (const q of byId.values()) {
		if (q != null && (!Number.isFinite(q) || q < 0)) return { ok: false, error: 'Rencana qty tidak valid.', status: 400 };
	}
	const ids = [...byId.keys()];

	const [rak, itemRows, dup, last] = await Promise.all([
		getRakForKelola(gudang_id),
		dgetStrict<any>(`/items/identitas_barang?filter[id][_in]=${ids.join(',')}&fields=id,nama_barang_lengkap&limit=-1`),
		dgetStrict<any>(
			`/items/gudang_item_placement?filter[gudang_id][_eq]=${gudang_id}&filter[identitas_barang_id][_in]=${ids.join(',')}&fields=identitas_barang_id&limit=-1`
		),
		// Taruh di urutan paling akhir supaya tidak mengacak susunan yang sudah ada.
		dget<any>(`/items/gudang_item_placement?filter[gudang_id][_eq]=${gudang_id}&sort=-urutan&fields=urutan&limit=1`)
	]);
	if (!rak) return { ok: false, error: 'Rak tidak ditemukan.', status: 404 };
	if (!rak.parent_gudang_id)
		return { ok: false, error: 'Item hanya bisa ditempatkan di rak/zona, bukan gudang level teratas.', status: 400 };

	const namaMap = new Map(itemRows.map((i: any) => [Number(i.id), (i.nama_barang_lengkap as string) || `#${i.id}`]));
	const sudahAda = new Set(dup.map((d: any) => Number(d.identitas_barang_id)));
	const dilewati: { item_id: number; nama: string; alasan: string }[] = [];
	const akanDibuat: number[] = [];
	for (const id of ids) {
		if (!namaMap.has(id)) dilewati.push({ item_id: id, nama: `#${id}`, alasan: 'Barang tidak ditemukan' });
		else if (sudahAda.has(id)) dilewati.push({ item_id: id, nama: namaMap.get(id)!, alasan: 'Sudah ada di rak ini' });
		else akanDibuat.push(id);
	}
	if (!akanDibuat.length) return { ok: true, ditambahkan: [], dilewati };

	let urutan = Number(last[0]?.urutan) || 0;
	const payload = akanDibuat.map((id) => ({
		gudang_id,
		identitas_barang_id: id,
		expected_qty: byId.get(id) ?? null,
		urutan: ++urutan
	}));
	const created = await directusServerJson<any>('/items/gudang_item_placement', {
		method: 'POST',
		body: JSON.stringify(payload)
	}).then((r) => r?.data ?? r);
	const createdRows: any[] = Array.isArray(created) ? created : [created];
	const ditambahkan = createdRows.map((c) => {
		const id = Number(c?.identitas_barang_id);
		return { item_id: id, placement_id: Number(c?.id), nama: namaMap.get(id) || `#${id}` };
	});

	// Audit: satu POST array ke scan_log (bukan N call). Non-fatal.
	const nowIso = new Date().toISOString();
	await directusServerJson('/items/scan_log', {
		method: 'POST',
		body: JSON.stringify(
			ditambahkan.map((d) => ({
				ref_collection: 'gudang_item_placement',
				ref_id: String(d.placement_id),
				actor_id: actor.karyawan_id,
				actor_role: 'kiosk_gudang',
				timestamp: nowIso,
				source: 'kiosk',
				stage_from: null,
				stage_to: `rak:${gudang_id}`,
				notes: `[KELOLA-RAK:TAMBAH] ${d.nama} ditambahkan ke ${rak.nama_gudang} — oleh ${actor.karyawan_nama} (#${actor.karyawan_id})`
			}))
		)
	}).catch((e) => console.warn('[kioskStok] gagal mencatat audit kelola rak (non-fatal)', e));
	await refreshLokasiCache(ditambahkan.map((d) => d.item_id));
	return { ok: true, ditambahkan, dilewati };
}

async function getPlacementInRak(placementId: number, gudangId: number) {
	const rows = await dgetStrict<any>(
		`/items/gudang_item_placement?filter[id][_eq]=${placementId}&fields=id,gudang_id,identitas_barang_id,expected_qty&limit=1`
	);
	const p = rows[0];
	if (!p || Number(p.gudang_id) !== gudangId) return null;
	return p;
}

async function ledgerStrict(gudangId: number, itemId: number): Promise<number> {
	// Jalur tulis: kegagalan baca ledger TIDAK BOLEH dianggap "stok 0" (bisa meloloskan hapus).
	const tx = await dgetStrict<any>(
		`/items/stock_transactions?filter[gudang_id][_eq]=${gudangId}&filter[item_id][_eq]=${itemId}` +
			`&filter[status][_nin]=rejected,pending_approval` +
			`&filter[_or][0][verification_status][_null]=true&filter[_or][1][verification_status][_neq]=pending` +
			`&fields=previous_stock,new_stock,quantity,category_transaction&limit=-1`
	);
	return tx.reduce((sum, t) => sum + ledgerDelta(t), 0);
}

/** Lepas item dari rak (hapus baris penempatan). Diblokir kalau stok tercatat di rak ini > 0. */
export async function hapusPlacement(input: {
	gudang_id: number;
	placement_id: number;
	actor: KelolaRakActor;
}): Promise<{ ok: true } | KelolaFail> {
	const { gudang_id, placement_id, actor } = input;
	const p = await getPlacementInRak(placement_id, gudang_id);
	if (!p) return { ok: false, error: 'Item tidak ditemukan di rak ini (mungkin sudah dihapus).', status: 404 };

	const qty = await ledgerStrict(gudang_id, Number(p.identitas_barang_id));
	if (qty > 0.0001)
		return {
			ok: false,
			error: `Masih ada stok tercatat ${qty} di rak ini. Pindahkan dulu jumlahnya ke rak lain, baru hapus.`,
			status: 409
		};

	const [rak, itemRows] = await Promise.all([
		getRakForKelola(gudang_id),
		dget<any>(`/items/identitas_barang?filter[id][_eq]=${p.identitas_barang_id}&fields=nama_barang_lengkap&limit=1`)
	]);
	await directusServerJson(`/items/gudang_item_placement/${placement_id}`, { method: 'DELETE' });

	await auditPlacement(
		actor,
		placement_id,
		'HAPUS',
		`${itemRows[0]?.nama_barang_lengkap || `#${p.identitas_barang_id}`} dilepas dari ${rak?.nama_gudang || `rak #${gudang_id}`}` +
			(p.expected_qty != null ? ` (rencana qty ${p.expected_qty})` : ''),
		`rak:${gudang_id}`,
		null
	);
	await refreshLokasiCache([Number(p.identitas_barang_id)]);
	return { ok: true };
}

/**
 * Pindah LOKASI penempatan saja (tanpa qty) — untuk item yang stok tercatatnya di rak ini
 * kosong. Kalau rak tujuan sudah punya item yang sama, baris asal dilebur (dihapus) dan
 * rencana qty-nya dijumlahkan ke tujuan.
 */
export async function pindahPlacement(input: {
	gudang_id: number;
	placement_id: number;
	rak_tujuan_id: number;
	actor: KelolaRakActor;
}): Promise<{ ok: true; digabung: boolean; rak_tujuan_nama: string } | KelolaFail> {
	const { gudang_id, placement_id, rak_tujuan_id, actor } = input;
	if (gudang_id === rak_tujuan_id) return { ok: false, error: 'Rak tujuan sama dengan rak ini.', status: 400 };

	const p = await getPlacementInRak(placement_id, gudang_id);
	if (!p) return { ok: false, error: 'Item tidak ditemukan di rak ini (mungkin sudah dipindah).', status: 404 };
	const itemId = Number(p.identitas_barang_id);

	const [asal, tujuan, qty] = await Promise.all([
		getRakForKelola(gudang_id),
		getRakForKelola(rak_tujuan_id),
		ledgerStrict(gudang_id, itemId)
	]);
	if (!asal) return { ok: false, error: 'Rak asal tidak ditemukan.', status: 404 };
	if (!tujuan) return { ok: false, error: 'Rak tujuan tidak ditemukan.', status: 404 };
	if (!asal.parent_gudang_id || !tujuan.parent_gudang_id)
		return { ok: false, error: 'Pindah hanya untuk rak/zona di dalam gudang, bukan gudang level teratas.', status: 400 };
	if (asal.parent_gudang_id !== tujuan.parent_gudang_id)
		return {
			ok: false,
			error: 'Rak tujuan ada di fasilitas berbeda. Pindah antar-fasilitas harus lewat Surat Jalan, bukan dari sini.',
			status: 400
		};
	if (qty > 0.0001)
		return {
			ok: false,
			error: `Rak ini masih mencatat stok ${qty}. Gunakan "Pindah dengan jumlah" supaya stoknya ikut pindah.`,
			status: 409
		};

	const tujuanP = await dgetStrict<any>(
		`/items/gudang_item_placement?filter[gudang_id][_eq]=${rak_tujuan_id}&filter[identitas_barang_id][_eq]=${itemId}&fields=id,expected_qty&limit=1`
	);

	let digabung = false;
	if (tujuanP[0]) {
		digabung = true;
		if (p.expected_qty != null) {
			await directusServerJson(`/items/gudang_item_placement/${tujuanP[0].id}`, {
				method: 'PATCH',
				body: JSON.stringify({ expected_qty: (Number(tujuanP[0].expected_qty) || 0) + (Number(p.expected_qty) || 0) })
			});
		}
		await directusServerJson(`/items/gudang_item_placement/${placement_id}`, { method: 'DELETE' });
	} else {
		const last = await dget<any>(
			`/items/gudang_item_placement?filter[gudang_id][_eq]=${rak_tujuan_id}&sort=-urutan&fields=urutan&limit=1`
		);
		await directusServerJson(`/items/gudang_item_placement/${placement_id}`, {
			method: 'PATCH',
			body: JSON.stringify({ gudang_id: rak_tujuan_id, urutan: (Number(last[0]?.urutan) || 0) + 1 })
		});
	}

	await auditPlacement(
		actor,
		digabung ? tujuanP[0].id : placement_id,
		'PINDAH',
		`Item #${itemId} dipindah ${asal.nama_gudang} → ${tujuan.nama_gudang}${digabung ? ' (digabung ke baris yang sudah ada)' : ''}`,
		`rak:${gudang_id}`,
		`rak:${rak_tujuan_id}`
	);
	await refreshLokasiCache([itemId]);
	return { ok: true, digabung, rak_tujuan_nama: tujuan.nama_gudang };
}

async function shiftPlacementExpected(
	rakAsalId: number,
	rakTujuanId: number,
	itemId: number,
	qty: number
): Promise<void> {
	const [asalP, tujuanP] = await Promise.all([
		dget<any>(
			`/items/gudang_item_placement?filter[gudang_id][_eq]=${rakAsalId}&filter[identitas_barang_id][_eq]=${itemId}&fields=id,expected_qty&limit=1`
		),
		dget<any>(
			`/items/gudang_item_placement?filter[gudang_id][_eq]=${rakTujuanId}&filter[identitas_barang_id][_eq]=${itemId}&fields=id,expected_qty&limit=1`
		)
	]);

	// Rak asal — kurangi expected_qty (kalau ada & bernilai).
	if (asalP[0] && asalP[0].expected_qty != null) {
		const sisa = Math.max(0, (Number(asalP[0].expected_qty) || 0) - qty);
		await directusServerJson(`/items/gudang_item_placement/${asalP[0].id}`, {
			method: 'PATCH',
			body: JSON.stringify({ expected_qty: sisa })
		});
	}

	// Rak tujuan — buat baris kalau belum ada, atau tambah expected_qty.
	if (tujuanP[0]) {
		const baru = (Number(tujuanP[0].expected_qty) || 0) + qty;
		await directusServerJson(`/items/gudang_item_placement/${tujuanP[0].id}`, {
			method: 'PATCH',
			body: JSON.stringify({ expected_qty: baru })
		});
	} else {
		await directusServerJson('/items/gudang_item_placement', {
			method: 'POST',
			body: JSON.stringify({
				gudang_id: rakTujuanId,
				identitas_barang_id: itemId,
				expected_qty: asalP[0]?.expected_qty != null ? qty : null
			})
		});
	}
}
