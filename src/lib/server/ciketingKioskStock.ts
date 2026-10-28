// src/lib/server/ciketingKioskStock.ts
// SERVER-ONLY. Potong bahan via scan QR — Kiosk WS Ciketing (Fase 3 konsolidasi
// ciketing_item -> Master Identitas, 20 Sep 2026, docs/(eh) implementation_plan_...).
//
// Fail-closed, pola sama dengan sjiStockMovement.ts: baca stok terkini dari
// ciketing_item.stok_tersedia (BUKAN identitas_barang.stok_tersedia -- itu total
// lintas lokasi, sumber kebenaran stok WS Ciketing sendiri tetap ciketing_item/
// ciketing_stok_ledger, konsisten dengan Fase 1-2 konsolidasi).
//
// File 12 §A (29 Sep 2026) — dua bug diperbaiki:
//   1. Tanpa CAS: dua operator memotong bahan yang sama bersamaan bisa saling
//      menimpa (lost update) -- baca-kurang-tulis tanpa lock.
//   2. Urutan lama (ledger dulu, baru PATCH saldo): kalau PATCH gagal, retry
//      menemukan ledger (via keterangan) dan membalas alreadyProcessed=true --
//      SALDO TIDAK PERNAH TURUN padahal ledger mencatat OUT. Dibalik: CAS saldo
//      DULU, baru tulis ledger; kalau ledger gagal, kompensasi (undo CAS) + alert.
//
// Idempoten: dedup via keterangan berisi clientTxnId (ciketing_stok_ledger belum
// punya kolom client_txn_id sendiri -- perlu keputusan skema terpisah, lihat file
// 12 dokumen; keterangan dipertahankan sebagai kunci sampai itu diputuskan).

import { directusServerJson } from './directus';
import { todayWib } from '$lib/utils/wibDate';
import { round4, STOK_BELUM_TERCATAT_MSG } from '$lib/utils/stokKiosk';

export interface CiketingCutInput {
	ciketingItemId: number;
	identitasBarangId: number | null;
	quantity: number;
	satuan: string;
	projectId: number;
	projectLabel: string;
	operatorName: string;
	clientTxnId: string;
	catatan?: string;
}

export interface CiketingCutResult {
	ledgerId: number;
	previousStock: number;
	newStock: number;
	alreadyProcessed: boolean;
}

/** Query yang MELEMPAR error alih-alih menelannya jadi array kosong (Aturan #1) — dipakai di
 *  jalur tulis (cek idempotensi, baca saldo terkini). `.catch(() => ({ data: [] }))` biasa
 *  hanya boleh untuk tampilan; di jalur tulis, Directus lambat/timeout dianggap "belum ada"
 *  dan memicu potong ganda pada retry. */
async function dgetStrict<T = any>(path: string): Promise<T[]> {
	const res = await directusServerJson<{ data: T[] }>(path);
	return res?.data || [];
}

/** CAS: PATCH stok_tersedia hanya kalau nilainya masih `expected` (nilai MENTAH hasil baca; null = belum tercatat) di server saat ini.
 *  0 baris ter-update = ada request lain yang menang duluan.
 *  ⚠️ Bentuk batch-by-query Directus: body { query: { filter }, data }. Filter di URL + body polos DITOLAK 400 ("data is required") —
 *  bentuk lama itu membuat potong bahan kiosk tidak pernah berhasil (terverifikasi 17 Okt 2026). */
export async function casPatchStok(itemId: number, expected: number | null, newStok: number): Promise<boolean> {
	const cond = expected === null ? { stok_tersedia: { _null: true } } : { stok_tersedia: { _eq: expected } };
	const res = await directusServerJson<{ data: any[] }>('/items/ciketing_item', {
		method: 'PATCH',
		body: JSON.stringify({ query: { filter: { _and: [{ id: { _eq: itemId } }, cond] }, fields: ['id'] }, data: { stok_tersedia: round4(newStok) } })
	});
	return Array.isArray(res?.data) && res.data.length > 0;
}

const CAS_MAX_ATTEMPTS = 5;

export async function ciketingKioskStockCut(input: CiketingCutInput): Promise<CiketingCutResult> {
	const { ciketingItemId, identitasBarangId, quantity, satuan, projectId, projectLabel, operatorName, clientTxnId, catatan } = input;
	const qty = parseFloat(String(quantity)) || 0;
	if (qty <= 0) throw new Error('Kuantitas harus lebih dari 0.');
	if (!ciketingItemId) throw new Error('Item Ciketing wajib diisi.');
	if (!projectId) throw new Error('SPK/Project wajib dipilih.');
	if (!clientTxnId) throw new Error('clientTxnId wajib diisi (idempotensi).');

	const baseKeterangan = `Kiosk Potong Bahan #${clientTxnId}${projectLabel ? ` - SPK ${projectLabel}` : ''}`;
	const keterangan = catatan ? `${baseKeterangan} - ${catatan}` : baseKeterangan;

	// Idempoten: cek dulu apakah transaksi dengan clientTxnId ini sudah pernah ditulis
	// (mis. retry jaringan setelah sukses tapi respons tidak sampai ke kiosk). dgetStrict —
	// kegagalan Directus di sini TIDAK BOLEH dianggap "belum ada" (Aturan #1).
	const dup = await dgetStrict<any>(
		`/items/ciketing_stok_ledger?filter[keterangan][_eq]=${encodeURIComponent(keterangan)}&fields=id&limit=1`
	);
	if (dup.length) {
		const cur = await dgetStrict<{ stok_tersedia: number }>(
			`/items/ciketing_item?filter[id][_eq]=${ciketingItemId}&fields=stok_tersedia&limit=1`
		);
		const stok = round4(Number(cur[0]?.stok_tersedia) || 0);
		return { ledgerId: dup[0].id, previousStock: round4(stok + qty), newStock: stok, alreadyProcessed: true };
	}

	// (1) CAS saldo DULU — baca nilai mentah, PATCH hanya kalau masih sama, ulangi kalau kalah race.
	let currentStock = 0;
	let currentRaw: number | null = null;
	let newStock = 0;
	let nama = String(ciketingItemId);
	let applied = false;
	let attempt = 0;
	while (!applied) {
		attempt++;
		const itemRows = await dgetStrict<{ id: number; stok_tersedia: number; nama_barang: string }>(
			`/items/ciketing_item?filter[id][_eq]=${ciketingItemId}&fields=id,stok_tersedia,nama_barang&limit=1`
		);
		const item = itemRows[0];
		if (!item) throw new Error('Barang Ciketing tidak ditemukan.');
		nama = item.nama_barang || nama;
		if (item.stok_tersedia === null || item.stok_tersedia === undefined) throw new Error(STOK_BELUM_TERCATAT_MSG(nama));
		currentRaw = Number(item.stok_tersedia);
		currentStock = round4(currentRaw);
		if (currentStock < qty) {
			throw new Error(`Stok "${nama}" tidak cukup. Tersedia: ${currentStock} ${satuan}, diminta: ${qty} ${satuan}.`);
		}
		newStock = round4(currentStock - qty);
		applied = await casPatchStok(ciketingItemId, currentRaw, newStock);
		if (!applied && attempt >= CAS_MAX_ATTEMPTS) {
			throw new Error('Gagal update stok — terlalu banyak transaksi bersamaan pada barang ini, coba lagi.');
		}
	}

	// (2) Tulis ledger. Kalau gagal, kompensasi (undo CAS) supaya saldo tidak diam-diam
	// berkurang tanpa jejak audit — kalau undo pun gagal, WAJIB terlihat manusia (alert critical).
	let ledger: { id: number };
	try {
		const ledgerRes = await directusServerJson<{ data: { id: number } }>('/items/ciketing_stok_ledger', {
			method: 'POST',
			body: JSON.stringify({
				// File 12 §E — UTC bikin input shift malam (00:00-06:59 WIB) tercatat tanggal
				// kemarin. todayWib() sudah dipakai modul lain (spk_daily_log dkk).
				tanggal: todayWib(),
				item: ciketingItemId,
				identitas_barang_id: identitasBarangId,
				tipe: 'OUT',
				qty,
				satuan,
				asal: 'Kiosk Potong Bahan',
				project: projectId,
				pic: operatorName,
				keterangan
			})
		});
		ledger = ledgerRes.data;
	} catch (e) {
		const undone = await casPatchStok(ciketingItemId, newStock, currentStock).catch(() => false); // saldo yang baru kita tulis = round4(newStock)
		if (!undone) {
			console.error('[ciketingKioskStock] KRITIS: stok sudah berubah tapi ledger gagal ditulis & undo gagal', {
				ciketingItemId,
				currentStock,
				newStock,
				clientTxnId
			});
			await directusServerJson('/items/automation_alerts', {
				method: 'POST',
				body: JSON.stringify({
					source: 'kiosk_ciketing_stock_write',
					severity: 'critical',
					is_resolved: false,
					message: `Stok Ciketing #${ciketingItemId} (${nama}) berubah ${currentStock} → ${newStock} tanpa baris ciketing_stok_ledger (txn ${clientTxnId}). Rekonsiliasi manual.`
				})
			}).catch(() => {});
		}
		throw e;
	}

	return { ledgerId: ledger.id, previousStock: currentStock, newStock, alreadyProcessed: false };
}
