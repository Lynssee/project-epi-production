// src/lib/server/sjiStockMovement.ts
// SERVER-ONLY. Port fail-closed dari erp-epi-1/src/lib/services/internalStockMovement.js,
// khusus dipanggil dari alur serah-terima/pengembalian SJI di project-epi (Fase 2).
//
// R5 (Rencana-Implementasi-SJ-Internal-v2-manual.md, §7): kegagalan stok harus MEMBATALKAN
// transisi status, bukan ditelan (pola catch-and-continue lama di deductStockForItems()).
// Fungsi ini melempar Error apa adanya bila gagal di langkah manapun — pemanggil WAJIB
// tidak mengubah status item/header kalau panggilan ini throw.

import { directusServerJson } from './directus';

export interface StockMovementInput {
	itemId: number;
	type: 'IN' | 'OUT';
	quantity: number;
	referenceNo: string;
	notes?: string;
	category: string;
	destination?: { destination_type?: string; destination_id?: number | string; destination_name?: string } | null;
	referenceId?: number | null;
	referenceType?: string | null;
	gudangId: number; // WAJIB di jalur SJI v2 (Fase 0.7) — beda dari versi admin yang masih opsional
}

export async function sjiStockMovement(input: StockMovementInput): Promise<{ id: number; previous_stock: number; new_stock: number }> {
	const { itemId, type, quantity, referenceNo, notes = '', category, destination = null, referenceId = null, referenceType = null, gudangId } = input;
	const qty = parseFloat(String(quantity)) || 0;
	if (qty <= 0) throw new Error('Kuantitas harus lebih dari 0.');
	if (!gudangId) throw new Error('gudangId wajib diisi untuk pergerakan stok SJI.');

	const itemRes = await directusServerJson<{ data: { id: number; stok_tersedia: string } }>(
		`/items/identitas_barang/${itemId}?fields=id,stok_tersedia`
	);
	const currentStock = parseFloat(itemRes?.data?.stok_tersedia) || 0;

	if (type === 'OUT' && currentStock < qty) {
		throw new Error(`Stok tidak cukup. Tersedia: ${currentStock}, Diminta: ${qty}.`);
	}
	const newStock = type === 'OUT' ? currentStock - qty : currentStock + qty;

	// Tulis transaksi dulu — kalau gagal, throw sebelum stok master ikut disentuh (fail-closed).
	const txRes = await directusServerJson<{ data: { id: number } }>('/items/stock_transactions', {
		method: 'POST',
		body: JSON.stringify({
			item_id: itemId,
			transaction_type: type,
			category_transaction: category,
			quantity: qty,
			previous_stock: currentStock,
			new_stock: newStock,
			reference_no: referenceNo || null,
			notes: notes || null,
			status: 'completed',
			transaction_date: new Date().toISOString(),
			destination_type: destination?.destination_type || null,
			destination_id: destination?.destination_id || null,
			destination_name: destination?.destination_name || null,
			reference_id: referenceId,
			reference_type: referenceType,
			gudang_id: gudangId
		})
	});
	const tx = txRes.data;

	// Update stok master — kalau ini gagal, transaksi SUDAH tercatat (beda dari deliverPengeluaran
	// admin yang menandai non-fatal): di sini kita tetap throw supaya pemanggil tidak menandai item
	// 'diserahkan' dengan stok master yang belum konsisten. stock_transactions yang sudah tercatat
	// jadi jejak audit untuk rekonsiliasi manual bila kasus ini benar-benar terjadi.
	await directusServerJson(`/items/identitas_barang/${itemId}`, {
		method: 'PATCH',
		body: JSON.stringify({ stok_tersedia: newStock })
	});

	return { id: tx.id, previous_stock: currentStock, new_stock: newStock };
}
