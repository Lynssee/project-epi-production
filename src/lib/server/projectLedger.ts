// src/lib/server/projectLedger.ts
// ⚠️ SERVER-ONLY. `project_stock_ledger` / `project_stock_balance` SUDAH ADA dan terisi di
// Directus produksi (per audit 18 Agustus 2026: 3.468 baris IN-RECEIPT, 2.434 baris balance).
// Yang belum berjalan: tidak ada satu pun transaksi keluar (OUT-USAGE/OUT-RETURN/OUT-LOSS/
// ADJ-OPNAME) pernah ditulis — lihat project-epi src/routes/api/inventory-proyek/usage/+server.ts
// (LEDGER_PILOT_PROJECT_IDS hardcoded ke 3 proyek pilot). Lihat
// erp-epi-1 src/lib/scripts/setup-project-stock-ledger-fase2.js untuk skema asal.
//
// PORT dari erp-epi-1 src/lib/server/projectLedger.js — dua deployment terpisah yang sama-sama
// menulis ke Directus yang sama (pola identik goodsReceived.ts di-port dari suratJalanApi.js).
// Kedua sisi HARUS tetap sinkron bila logika validasi/tanda berubah.

import { directusServerJson } from './directus';

export const TRANSACTION_TYPES = {
	IN_RECEIPT: 'IN-RECEIPT',
	IN_PURCHASE: 'IN-PURCHASE',
	OUT_USAGE: 'OUT-USAGE',
	OUT_RETURN: 'OUT-RETURN',
	OUT_LOSS: 'OUT-LOSS',
	ADJ_OPNAME: 'ADJ-OPNAME',
	// Fase 3, Rencana v2 "Lifecycle Pengembalian Barang" (25-26 Sep 2026): transfer material
	// antar-proyek dari sisi leader lapangan -- TRANSFER-OUT di proyek asal + TRANSFER-IN di
	// proyek tujuan, ditulis sebagai sepasang dalam satu request server (lihat endpoint
	// /api/inventory-proyek/transfer). Port dari erp-epi-1 (sudah ada sejak Fase 2 MLE 10 Agu
	// 2026 untuk sisi admin) -- ditambahkan di sini SEKARANG karena project-epi belum punya.
	TRANSFER_OUT: 'TRANSFER-OUT',
	TRANSFER_IN: 'TRANSFER-IN'
} as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[keyof typeof TRANSACTION_TYPES];

// Fase 2 (Bab 7.4): tanda quantity ditentukan tipe transaksi, KECUALI ADJ-OPNAME yang
// tandanya ditentukan hasil opname (bisa + atau -) — pemanggil wajib kirim quantity
// bertanda benar untuk ADJ-OPNAME, fungsi ini hanya memvalidasi konsistensi utk tipe lain.
const FIXED_SIGN_BY_TYPE: Record<TransactionType, 1 | -1 | null> = {
	[TRANSACTION_TYPES.IN_RECEIPT]: 1,
	[TRANSACTION_TYPES.IN_PURCHASE]: 1,
	[TRANSACTION_TYPES.OUT_USAGE]: -1,
	[TRANSACTION_TYPES.OUT_RETURN]: -1,
	[TRANSACTION_TYPES.OUT_LOSS]: -1,
	[TRANSACTION_TYPES.ADJ_OPNAME]: null, // bebas tanda
	[TRANSACTION_TYPES.TRANSFER_OUT]: -1,
	[TRANSACTION_TYPES.TRANSFER_IN]: 1
};

export interface AppendLedgerEntryParams {
	projectId: number;
	itemId: number;
	projectBudgetId?: number | null;
	transactionType: TransactionType;
	quantity: number;
	unitPrice?: number;
	referenceType?: string | null;
	referenceId?: string | number | null;
	referenceNo?: string | null;
	evidencePhoto?: string | null;
	evidenceGps?: { lat: number; lng: number; accuracy?: number } | null;
	submittedBy?: number | null;
	clientTxnId: string;
	ownershipType?: 'eltama' | 'subcon' | 'customer' | 'sewa_vendor';
	ownerName?: string | null;
}

/**
 * Tambah satu baris ke project_stock_ledger. Append-only — tidak ada update/delete di sini
 * sesuai desain (Bab 5): koreksi dilakukan lewat baris penyeimbang baru, bukan mengedit baris lama.
 *
 * Idempoten lewat client_txn_id: bila baris dengan client_txn_id yang sama sudah ada, fungsi ini
 * mengembalikan baris existing tanpa insert ulang (bukan error) — penting untuk retry n8n / HP
 * lapangan yang kehilangan sinyal lalu mengirim ulang permintaan yang sama.
 */
export async function appendLedgerEntry(params: AppendLedgerEntryParams) {
	const {
		projectId,
		itemId,
		projectBudgetId = null,
		transactionType,
		quantity,
		unitPrice = 0,
		referenceType = null,
		referenceId = null,
		referenceNo = null,
		evidencePhoto = null,
		evidenceGps = null,
		submittedBy = null,
		clientTxnId,
		ownershipType = 'eltama',
		ownerName = null
	} = params;

	if (!projectId) throw new Error('projectId wajib diisi');
	if (!itemId) throw new Error('itemId wajib diisi — ledger menolak baris tanpa identitas item (Bab 6)');
	if (!Object.values(TRANSACTION_TYPES).includes(transactionType)) {
		throw new Error(`transactionType tidak dikenal: ${transactionType}`);
	}
	if (!clientTxnId) throw new Error('clientTxnId wajib diisi — kunci idempotensi, jangan uuid acak per eksekusi retry');
	if (!Number.isFinite(quantity) || quantity === 0) throw new Error('quantity wajib angka bukan nol');

	const expectedSign = FIXED_SIGN_BY_TYPE[transactionType];
	if (expectedSign !== null) {
		const actualSign = quantity > 0 ? 1 : -1;
		if (actualSign !== expectedSign) {
			throw new Error(
				`quantity harus ${expectedSign > 0 ? 'positif' : 'negatif'} untuk transactionType=${transactionType}, diterima ${quantity}`
			);
		}
	}

	// Idempotensi: cek dulu, jangan andalkan unique constraint 409 saja -- retry harus
	// terasa sukses bagi pemanggil (HP lapangan / n8n), bukan error yang memicu retry lagi.
	const existing = await directusServerJson<{ data: any[] }>(
		`/items/project_stock_ledger?filter[client_txn_id][_eq]=${encodeURIComponent(clientTxnId)}&limit=1`
	).catch(() => null);
	if (existing?.data?.length) {
		return { entry: existing.data[0], deduped: true };
	}

	const totalValue = quantity * (unitPrice || 0);

	const res = await directusServerJson<{ data: any }>('/items/project_stock_ledger', {
		method: 'POST',
		body: JSON.stringify({
			project_id: projectId,
			item_id: itemId,
			project_budget_id: projectBudgetId,
			transaction_type: transactionType,
			quantity,
			unit_price: unitPrice,
			total_value: totalValue,
			reference_type: referenceType,
			reference_id: referenceId != null ? String(referenceId) : null,
			reference_no: referenceNo,
			evidence_photo: evidencePhoto,
			evidence_gps: evidenceGps,
			submitted_by: submittedBy,
			client_txn_id: clientTxnId,
			ownership_type: ownershipType,
			owner_name: ownerName
		})
	});

	return { entry: res?.data, deduped: false };
}

interface BalanceGroup {
	project_id: number;
	item_id: number;
	qty_received: number;
	qty_used: number;
	qty_lost: number;
	qty_returned: number;
	qty_on_hand: number;
	last_movement_date: string | null;
	ownership_type: string;
	owner_name: string | null;
}

/**
 * Hitung ulang project_stock_balance dari project_stock_ledger. Aman dipanggil kapan saja —
 * cache boleh dianggap sampah dan dibangun ulang total (Bab 7.1). Dipanggil oleh cron n8n
 * harian (Bab 11, workflow #4) dan sekali manual saat inisialisasi Fase 2.
 *
 * @param scope kosongkan untuk rebuild semua proyek (bisa berat untuk ledger besar).
 */
export async function rebuildProjectStockBalance(scope: { projectId?: number } = {}) {
	const { projectId } = scope;

	const filter = projectId ? { project_id: { _eq: projectId } } : {};
	const ledgerRows: any[] = [];
	let page = 1;
	const pageSize = 500;
	// Paginasi manual -- limit=-1 di production Directus dengan ledger besar bisa timeout.
	while (true) {
		const query = new URLSearchParams({
			filter: JSON.stringify(filter),
			fields: 'project_id,item_id,transaction_type,quantity,date_created,ownership_type,owner_name',
			sort: 'date_created',
			limit: String(pageSize),
			page: String(page)
		});
		const res = await directusServerJson<{ data: any[] }>(`/items/project_stock_ledger?${query.toString()}`);
		const rows = res?.data || [];
		ledgerRows.push(...rows);
		if (rows.length < pageSize) break;
		page++;
	}

	const groups = new Map<string, BalanceGroup>();
	for (const row of ledgerRows) {
		const ownType = row.ownership_type || 'eltama';
		const ownName = row.owner_name || '';
		const key = `${row.project_id}:${row.item_id}:${ownType}:${ownName}`;
		let g = groups.get(key);
		if (!g) {
			g = {
				project_id: row.project_id,
				item_id: row.item_id,
				qty_received: 0,
				qty_used: 0,
				qty_lost: 0,
				qty_returned: 0,
				qty_on_hand: 0,
				last_movement_date: null,
				ownership_type: ownType,
				owner_name: row.owner_name || null
			};
			groups.set(key, g);
		}
		const qty = Number(row.quantity) || 0;
		g.qty_on_hand += qty;
		if (row.transaction_type === TRANSACTION_TYPES.IN_RECEIPT || row.transaction_type === TRANSACTION_TYPES.IN_PURCHASE) {
			g.qty_received += qty;
		} else if (row.transaction_type === TRANSACTION_TYPES.OUT_USAGE) {
			g.qty_used += Math.abs(qty);
		} else if (row.transaction_type === TRANSACTION_TYPES.OUT_LOSS) {
			g.qty_lost += Math.abs(qty);
		} else if (row.transaction_type === TRANSACTION_TYPES.OUT_RETURN) {
			g.qty_returned += Math.abs(qty);
		}
		if (!g.last_movement_date || row.date_created > g.last_movement_date) {
			g.last_movement_date = row.date_created;
		}
	}

	const now = new Date().toISOString();
	let upserted = 0;
	for (const g of groups.values()) {
		const rabQtyRes = await directusServerJson<{ data: any[] }>(
			`/items/project_budgets?filter[project_id][_eq]=${g.project_id}&filter[identitas_barang_id][_eq]=${g.item_id}&fields=qty&limit=-1`
		).catch(() => null);
		const rabQty = (rabQtyRes?.data || []).reduce((sum, r) => sum + (Number(r.qty) || 0), 0);

		let status = 'normal';
		if (g.qty_on_hand < 0) status = 'critical';
		else if (rabQty > 0 && g.qty_on_hand > rabQty) status = 'over_rab';
		// Placeholder heuristik 'low' (<10% RAB) -- kalibrasi ulang setelah data Fase 2 riil ada,
		// bukan angka final. Dicatat di Bab 14 sebagai area yang belum punya definisi resmi.
		else if (rabQty > 0 && g.qty_on_hand < rabQty * 0.1) status = 'low';

		const existingRes = await directusServerJson<{ data: any[] }>(
			`/items/project_stock_balance?filter[project_id][_eq]=${g.project_id}&filter[item_id][_eq]=${g.item_id}&filter[ownership_type][_eq]=${encodeURIComponent(g.ownership_type)}&limit=1`
		).catch(() => null);
		const existing = existingRes?.data?.[0];

		const body = {
			project_id: g.project_id,
			item_id: g.item_id,
			qty_received: g.qty_received,
			qty_used: g.qty_used,
			qty_lost: g.qty_lost,
			qty_returned: g.qty_returned,
			qty_on_hand: g.qty_on_hand,
			rab_qty: rabQty,
			last_movement_date: g.last_movement_date,
			last_rebuilt_at: now,
			status,
			ownership_type: g.ownership_type,
			owner_name: g.owner_name
		};

		if (existing) {
			await directusServerJson(`/items/project_stock_balance/${existing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
		} else {
			await directusServerJson('/items/project_stock_balance', { method: 'POST', body: JSON.stringify(body) });
		}
		upserted++;
	}

	return { groupsProcessed: upserted, ledgerRowsScanned: ledgerRows.length, rebuiltAt: now };
}
