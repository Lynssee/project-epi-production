import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';

// Fase 3 Stok Kritis Terpusat: baca collection `project_stock_balance` yang SAMA PERSIS dipakai
// admin (erp-epi-1 `getLowStockBalancesAcrossProjects` di projectMaterialPlanApi.js) — status
// 'low'/'critical' dihitung server-side saat rebuild (projectLedger.js di erp-epi-1), TIDAK
// dihitung ulang di sini. Definisi "kritis" jadi identik lintas dashboard karena sumber datanya
// literally field yang sama, bukan formula yang disalin ulang.

export interface LowStockBalanceRow {
	id: number;
	project_id: number;
	item_id: number;
	item_name: string;
	item_satuan: string;
	qty_received: number;
	qty_used: number;
	qty_on_hand: number;
	rab_qty: number;
	status: 'normal' | 'low' | 'critical' | 'over_rab';
	last_movement_date: string | null;
	ownership_type?: string;
	owner_name?: string | null;
}

/** Balance stok rendah/kritis untuk proyek-proyek tertentu (batch _in) — kosongkan projectIds
 *  untuk hasil kosong (least-privilege, sama pola getPayrollRunsForProjects). */
export async function getLowStockBalancesForProjects(projectIds: number[]): Promise<LowStockBalanceRow[]> {
	if (!projectIds || projectIds.length === 0) return [];
	try {
		const balances = (await directus.request(
			readItems('project_stock_balance', {
				fields: [
					'id',
					'project_id',
					'item_id',
					'qty_received',
					'qty_used',
					'qty_on_hand',
					'rab_qty',
					'status',
					'last_movement_date',
					'ownership_type',
					'owner_name'
				],
				filter: {
					status: { _in: ['low', 'critical'] },
					project_id: { _in: projectIds }
				},
				sort: ['status'],
				limit: 200
			})
		)) as any[];
		if (!balances || balances.length === 0) return [];

		const itemIds = [...new Set(balances.map((b) => b.item_id).filter(Boolean))];
		let itemMap: Record<number, { nama_barang_lengkap?: string; satuan?: string }> = {};
		if (itemIds.length > 0) {
			const items = (await directus.request(
				readItems('identitas_barang' as any, {
					fields: ['id', 'nama_barang_lengkap', 'satuan'],
					filter: { id: { _in: itemIds } },
					limit: -1
				})
			)) as any[];
			for (const it of items || []) itemMap[it.id] = it;
		}

		return balances.map((b) => ({
			id: b.id,
			project_id: b.project_id,
			item_id: b.item_id,
			item_name: itemMap[b.item_id]?.nama_barang_lengkap || `Item #${b.item_id}`,
			item_satuan: itemMap[b.item_id]?.satuan || '',
			qty_received: Number(b.qty_received || 0),
			qty_used: Number(b.qty_used || 0),
			qty_on_hand: Number(b.qty_on_hand || 0),
			rab_qty: Number(b.rab_qty || 0),
			status: b.status,
			last_movement_date: b.last_movement_date || null,
			ownership_type: b.ownership_type || 'eltama',
			owner_name: b.owner_name || null
		}));
	} catch (error: any) {
		handleDirectusError(error);
		console.error('getLowStockBalancesForProjects:', error);
		return [];
	}
}

/** Fase 3 (§ Rencana "Integrasi Status Stok Site Proyek"): SEMUA saldo (bukan cuma low/critical
 *  seperti getLowStockBalancesForProjects di atas) — dipakai panel ringkasan inventory site untuk
 *  leader mengecek barang yang MASIH ADA di kontainer proyek sebelum memesan lagi. */
export async function getAllStockBalancesForProjects(projectIds: number[]): Promise<LowStockBalanceRow[]> {
	if (!projectIds || projectIds.length === 0) return [];
	try {
		const balances = (await directus.request(
			readItems('project_stock_balance', {
				fields: [
					'id',
					'project_id',
					'item_id',
					'qty_received',
					'qty_used',
					'qty_on_hand',
					'rab_qty',
					'status',
					'last_movement_date',
					'ownership_type',
					'owner_name'
				],
				filter: {
					project_id: { _in: projectIds },
					qty_on_hand: { _gt: 0 }
				},
				sort: ['status', '-qty_on_hand'],
				limit: 500
			})
		)) as any[];
		if (!balances || balances.length === 0) return [];

		const itemIds = [...new Set(balances.map((b) => b.item_id).filter(Boolean))];
		let itemMap: Record<number, { nama_barang_lengkap?: string; satuan?: string }> = {};
		if (itemIds.length > 0) {
			const items = (await directus.request(
				readItems('identitas_barang', {
					fields: ['id', 'nama_barang_lengkap', 'satuan'],
					filter: { id: { _in: itemIds } },
					limit: -1
				})
			)) as any[];
			for (const it of items || []) itemMap[it.id] = it;
		}

		return balances.map((b) => ({
			id: b.id,
			project_id: b.project_id,
			item_id: b.item_id,
			item_name: itemMap[b.item_id]?.nama_barang_lengkap || `Item #${b.item_id}`,
			item_satuan: itemMap[b.item_id]?.satuan || '',
			qty_received: Number(b.qty_received || 0),
			qty_used: Number(b.qty_used || 0),
			qty_on_hand: Number(b.qty_on_hand || 0),
			rab_qty: Number(b.rab_qty || 0),
			status: b.status,
			last_movement_date: b.last_movement_date || null,
			ownership_type: b.ownership_type || 'eltama',
			owner_name: b.owner_name || null
		}));
	} catch (error: any) {
		handleDirectusError(error);
		console.error('getAllStockBalancesForProjects:', error);
		return [];
	}
}

export interface IdleStockBalanceRow {
	id: number;
	project_id: number;
	item_id: number;
	item_name: string;
	item_satuan: string;
	qty_on_hand: number;
	last_movement_date: string | null;
	hari_menganggur: number | null;
}

/** Uji Kebutuhan Beli Fase 4.3 — "sisi pasok" kanal K4: stok proyek ini yang masih ada
 *  (qty_on_hand > 0) tapi tidak bergerak > 30 hari. Sumber data SAMA PERSIS dengan yang
 *  dibaca kanal K4 mesin UKB di admin (purchaseNecessity.js findStockAtOtherProjects) --
 *  panel ini murni membantu PM MELIHAT & menawarkan barangnya sendiri, tidak menghitung
 *  ulang apa pun. Catatan: getLowStockBalancesForProjects di atas keliru membaca
 *  collection `items` (seharusnya `identitas_barang`, lihat identitas_barang di admin) --
 *  BUKAN diperbaiki di sini (di luar cakupan UKB), fungsi baru ini pakai nama yang benar. */
export async function getIdleBalancesForProjects(projectIds: number[], minIdleDays = 30): Promise<IdleStockBalanceRow[]> {
	if (!projectIds || projectIds.length === 0) return [];
	try {
		const ambangTanggal = new Date(Date.now() - minIdleDays * 86400000).toISOString();
		const balances = (await directus.request(
			readItems('project_stock_balance', {
				fields: ['id', 'project_id', 'item_id', 'qty_on_hand', 'last_movement_date'],
				filter: {
					project_id: { _in: projectIds },
					qty_on_hand: { _gt: 0 },
					_or: [{ last_movement_date: { _lte: ambangTanggal } }, { last_movement_date: { _null: true } }]
				},
				sort: ['last_movement_date'],
				limit: 200
			})
		)) as any[];
		if (!balances || balances.length === 0) return [];

		const itemIds = [...new Set(balances.map((b) => b.item_id).filter(Boolean))];
		let itemMap: Record<number, { nama_barang_lengkap?: string; satuan?: string }> = {};
		if (itemIds.length > 0) {
			const items = (await directus.request(
				readItems('identitas_barang', {
					fields: ['id', 'nama_barang_lengkap', 'satuan'],
					filter: { id: { _in: itemIds } },
					limit: -1
				})
			)) as any[];
			for (const it of items || []) itemMap[it.id] = it;
		}

		const now = Date.now();
		return balances.map((b) => ({
			id: b.id,
			project_id: b.project_id,
			item_id: b.item_id,
			item_name: itemMap[b.item_id]?.nama_barang_lengkap || `Item #${b.item_id}`,
			item_satuan: itemMap[b.item_id]?.satuan || '',
			qty_on_hand: Number(b.qty_on_hand || 0),
			last_movement_date: b.last_movement_date || null,
			hari_menganggur: b.last_movement_date ? Math.floor((now - new Date(b.last_movement_date).getTime()) / 86400000) : null
		}));
	} catch (error: any) {
		handleDirectusError(error);
		console.error('getIdleBalancesForProjects:', error);
		return [];
	}
}
