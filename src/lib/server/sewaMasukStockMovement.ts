// src/lib/server/sewaMasukStockMovement.ts
// SERVER-ONLY. Port fail-closed dari erp-epi-1/src/lib/server/sewaMasukEngine.js, khusus
// dipanggil dari gate QR kedatangan/retur sewa_masuk di project-epi (Fase 4). Pola sama dgn
// sjiStockMovement.ts -- project-epi & erp-epi TIDAK saling panggil API, keduanya menulis
// langsung ke Directus yang sama (lihat catatan cross-repo di memori project).
//
// Hukum #1 (barang sewa TIDAK PERNAH punya nilai): fungsi ini SENGAJA tidak menyentuh
// harga_beli/avg_cost sama sekali -- kolom itu sudah 0 sejak identitas_barang "SWA-" dibuat
// (createSewaMasukItem di erp-epi), dan kode aktivitas IN-17/OUT-13 memang tidak dijurnal
// (stock_activity_journal_map.is_active=false, lihat Fase 1).

import { directusServerJson } from './directus';

export interface SewaStockMovementInput {
	itemId: number;
	type: 'IN' | 'OUT';
	quantity: number;
	categoryTransaction: 'IN-17' | 'OUT-13';
	referenceNo?: string;
	notes?: string;
	gudangId?: number | null;
}

export async function sewaMasukStockMovement(input: SewaStockMovementInput): Promise<{ id: number; previous_stock: number; new_stock: number }> {
	const { itemId, type, quantity, categoryTransaction, referenceNo = '', notes = '', gudangId = null } = input;
	const qty = parseFloat(String(quantity)) || 0;
	if (qty <= 0) throw new Error('Kuantitas harus lebih dari 0.');

	const itemRes = await directusServerJson<{ data: { id: number; stok_tersedia: string; kepemilikan: string } }>(
		`/items/identitas_barang/${itemId}?fields=id,stok_tersedia,kepemilikan`
	);
	const item = itemRes?.data;
	if (!item) throw new Error('Item sewa tidak ditemukan.');
	// Guard tambahan (di luar guard Fase 2 erp-epi yang tidak bisa dijangkau dari sini) --
	// gate ini HANYA untuk barang sewa, jangan sampai salah pakai untuk item milik sendiri.
	if (item.kepemilikan !== 'sewa') throw new Error('Item ini bukan barang sewa (kepemilikan != "sewa") -- gate ini tidak berlaku.');

	const currentStock = parseFloat(item.stok_tersedia) || 0;
	if (type === 'OUT' && currentStock < qty) {
		throw new Error(`Stok sewa tidak cukup untuk retur. Tersedia: ${currentStock}, Diminta: ${qty}.`);
	}
	const newStock = type === 'OUT' ? currentStock - qty : currentStock + qty;

	// Tulis transaksi dulu — kalau gagal, throw sebelum stok master ikut disentuh (fail-closed,
	// pola sama dgn sjiStockMovement.ts).
	const txRes = await directusServerJson<{ data: { id: number } }>('/items/stock_transactions', {
		method: 'POST',
		body: JSON.stringify({
			item_id: itemId,
			transaction_type: type,
			category_transaction: categoryTransaction,
			quantity: qty,
			previous_stock: currentStock,
			new_stock: newStock,
			unit_price: 0,
			total_value: 0,
			reference_no: referenceNo || null,
			notes: notes || null,
			status: 'completed',
			transaction_date: new Date().toISOString(),
			gudang_id: gudangId
		})
	});
	const tx = txRes.data;
	if (!tx?.id) throw new Error('Gagal mencatat stock_transactions untuk gate sewa.');

	await directusServerJson(`/items/identitas_barang/${itemId}`, {
		method: 'PATCH',
		body: JSON.stringify({ stok_tersedia: newStock, stok_total: newStock })
	});

	return { id: tx.id, previous_stock: currentStock, new_stock: newStock };
}

/**
 * Fase 8 (A5, Rencana Pertajam Rental Order v2 §9.1) — daftarkan item sewa yang BARU TIBA
 * sebagai baris `equipment`, supaya lapangan bisa mengisi P2H (hour-meter) untuknya seperti
 * alat biasa -- tanpa ini, tidak ada cara mendeteksi "sewa menganggur" (P2H/hoursmeter
 * di-keyed ke equipment_id, BUKAN identitas_barang_id).
 *
 * `equipment` adalah master AKTIF dipakai >60 file lain (Maintenance/Procurement/Sales/dst) --
 * fungsi ini SENGAJA gagal-lembut (tidak melempar, hanya warning) supaya kegagalan
 * pendaftaran equipment TIDAK PERNAH menggagalkan gate kedatangan yang sebenarnya (stok +
 * foto/kondisi tetap tercatat walau equipment gagal didaftarkan -- bisa didaftarkan manual
 * belakangan lewat Directus kalau perlu).
 *
 * Kategori "EQUIPMENT" (category_id) di-hardcode ke UUID yang sudah diverifikasi ada di
 * skema live (`category.group='asset_category'`, name='EQUIPMENT') -- lihat riset 21 Sep.
 */
const EQUIPMENT_CATEGORY_ID = '0809bf4d-bebd-45ef-b361-3dd30c34e9b0'; // category.name='EQUIPMENT', group='asset_category'
const FALLBACK_LOCATION_NAME = 'BK/Kantor';

export interface DaftarkanEquipmentInput {
	identitasBarangId: number;
	namaBarang: string;
	kodeItem: string; // dipakai sbg equipment.code (unik, sama dgn SWA-000123)
	vendorName?: string;
	projectId?: number | null;
	projectName?: string | null;
}

async function cariAtauBuatLocationId(namaLokasi: string): Promise<string | null> {
	try {
		const existing = await directusServerJson<{ data: Array<{ id: string }> }>(
			`/items/location?filter[name][_eq]=${encodeURIComponent(namaLokasi)}&limit=1&fields=id`
		).catch(() => null);
		const found = existing?.data?.[0]?.id;
		if (found) return found;

		const created = await directusServerJson<{ data: { id: string } }>('/items/location', {
			method: 'POST',
			body: JSON.stringify({ name: namaLokasi })
		}).catch(() => null);
		return created?.data?.id || null;
	} catch (e) {
		console.warn('[sewaMasukStockMovement] gagal cari/buat location:', (e as Error).message);
		return null;
	}
}

export async function daftarkanEquipmentUntukSewaMasuk(input: DaftarkanEquipmentInput): Promise<{ equipmentId: string | null }> {
	try {
		// Idempoten -- gate bisa di-retry (klik dobel/koneksi putus), jangan bikin baris equipment kedua.
		const existing = await directusServerJson<{ data: Array<{ id: string }> }>(
			`/items/equipment?filter[identitas_barang_id][_eq]=${input.identitasBarangId}&limit=1&fields=id`
		).catch(() => null);
		if (existing?.data?.[0]?.id) return { equipmentId: existing.data[0].id };

		const locationId = await cariAtauBuatLocationId(input.projectName?.trim() || FALLBACK_LOCATION_NAME);
		if (!locationId) {
			console.warn('[sewaMasukStockMovement] gagal resolve location_id, equipment TIDAK didaftarkan (gate kedatangan tetap lanjut).');
			return { equipmentId: null };
		}

		const created = await directusServerJson<{ data: { id: string } }>('/items/equipment', {
			method: 'POST',
			body: JSON.stringify({
				code: input.kodeItem,
				name: input.namaBarang,
				brand: input.vendorName?.trim() || 'Sewa Vendor',
				category_id: EQUIPMENT_CATEGORY_ID,
				location_id: locationId,
				operational_mode: 'rental',
				status_operational: 'rental_in',
				identitas_barang_id: input.identitasBarangId
			})
		});
		return { equipmentId: created?.data?.id || null };
	} catch (e) {
		console.warn('[sewaMasukStockMovement] gagal daftarkan equipment utk item sewa:', (e as Error).message);
		return { equipmentId: null };
	}
}
