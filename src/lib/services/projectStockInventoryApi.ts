import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem } from '@directus/sdk';

export type InventoryCategory = 'consumable' | 'equipment' | 'material';
export type ConditionStatus = 'diterima' | 'dipakai' | 'rusak' | 'dikembalikan' | 'hilang';

export interface ProjectStockItem {
	id: number;
	itemId: number;
	namaBarang: string;
	kodeItem?: string;
	satuan: string;
	category: InventoryCategory;
	qtyOnHand: number;
	qtyReceived: number;
	qtyUsed: number;
	qtyDamaged: number;
	qtyReturned: number;
	lastMovementDate?: string;
}

export interface ProjectStockMovementPayload {
	projectId: number | string;
	itemId: number;
	movementType: 'IN' | 'OUT';
	conditionStatus: ConditionStatus;
	quantity: number;
	suratJalanRef?: string | null;
	category?: InventoryCategory;
	notes?: string | null;
	reportedBy: string;
}

export interface ProjectStockTransaction {
	id: number;
	date: string;
	itemId: number;
	namaBarang: string;
	satuan: string;
	category: InventoryCategory;
	type: 'IN' | 'OUT';
	conditionStatus: ConditionStatus;
	qty: number;
	suratJalanRef: string | null;
	notes: string | null;
	source: string;
	refNo: string;
}

export interface SuratJalanOption {
	id: number | string;
	nomorSj: string;
	tanggal: string;
	tujuan?: string;
	tipe: 'SJI' | 'SJM' | 'SJ_HQ';
}

/**
 * Determine item category (Consumable, Equipment, Material) based on item master attributes
 */
export function determineItemCategory(item: any): InventoryCategory {
	if (!item) return 'material';
	// FIX (2.5, Rencana Standarisasi Inventory): `item.jenis`/`item.kategori_id`/`item.kategori_name`
	// TIDAK PERNAH ADA di skema identitas_barang sungguhan (dikonfirmasi via Directus schema, 19 Agu
	// 2026) -- field klasifikasi kategori yang sebenarnya adalah relasi `parent_category` (M2O ->
	// parent_category.parent_category, mis. "TOOLS"/"MESIN"/"POWER") dan `sub_category` (M2O ->
	// sub_category.nama_sub). Query lama yang eksplisit minta field `jenis` di `fields:[...]` bikin
	// SELURUH request identitas_barang gagal FORBIDDEN di runtime role lapangan (field tak dikenal),
	// bukan cuma katName-nya yang kosong -- lihat 3 titik fetch di file ini yang ikut diperbaiki.
	const katName = (
		item.parent_category?.parent_category ||
		item.sub_category?.nama_sub ||
		item.tipe ||
		''
	).toLowerCase();

	if (
		item.category_type === 'equipment' ||
		item.is_borrowable === true ||
		katName.includes('equipment') ||
		katName.includes('peralatan') ||
		katName.includes('mesin') ||
		katName.includes('tools')
	) {
		return 'equipment';
	}

	if (
		item.consumable === true ||
		item.category_type === 'consumable' ||
		katName.includes('consumable') ||
		katName.includes('habis pakai') ||
		katName.includes('majun') ||
		katName.includes('apd')
	) {
		return 'consumable';
	}

	return 'material';
}

/**
 * Fetch project stock balance and list items for a specific project from project_stock_balance.
 * Note: Relation fetching is separated per Directus rules.
 */
export async function getProjectInventory(projectId: number | string): Promise<ProjectStockItem[]> {
	try {
		const pIdNum = Number(projectId);
		if (!Number.isFinite(pIdNum)) return [];

		// 1. Fetch live project stock balances
		const balances = (await directus.request(
			readItems('project_stock_balance', {
				filter: { project_id: { _eq: pIdNum } },
				fields: [
					'id',
					'project_id',
					'item_id',
					'qty_on_hand',
					'qty_received',
					'qty_used',
					'qty_lost',
					'qty_returned',
					'rab_qty',
					'status',
					'last_movement_date',
					'ownership_type',
					'owner_name'
				],
				limit: -1
			})
		)) as any[];

		if (!balances || balances.length === 0) {
			return [];
		}

		// 2. Fetch master items in separate request (Directus rule: separate relation fetching)
		const itemIds = Array.from(new Set(balances.map((b) => b.item_id).filter(Boolean)));
		let itemMap = new Map<number, any>();

		if (itemIds.length > 0) {
			const masterItems = (await directus.request(
				readItems('identitas_barang', {
					filter: { id: { _in: itemIds } },
					fields: [
						'id',
						'nama_barang_lengkap',
						'kode_item',
						'satuan',
						'is_borrowable',
						'consumable',
						'tipe',
						'parent_category.parent_category',
						'sub_category.nama_sub'
					],
					limit: -1
				})
			)) as any[];
			masterItems.forEach((ib) => itemMap.set(ib.id, ib));
		}

		return balances.map((b) => {
			const master = itemMap.get(b.item_id);
			return {
				id: b.id,
				itemId: b.item_id,
				namaBarang: master?.nama_barang_lengkap || `Item #${b.item_id}`,
				kodeItem: master?.kode_item || '',
				satuan: master?.satuan || 'pcs',
				category: determineItemCategory(master),
				qtyOnHand: Number(b.qty_on_hand) || 0,
				qtyReceived: Number(b.qty_received) || 0,
				qtyUsed: Number(b.qty_used) || 0,
				qtyDamaged: Number(b.qty_lost) || 0,
				qtyReturned: Number(b.qty_returned) || 0,
				lastMovementDate: b.last_movement_date || null
			};
		});
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Fetch project stock transaction history from project_stock_ledger.
 */
export async function getProjectInventoryLogs(projectId: number | string): Promise<ProjectStockTransaction[]> {
	try {
		const pIdNum = Number(projectId);
		if (!Number.isFinite(pIdNum)) return [];

		// 1. Fetch ledger entries for this project
		const ledgerRows = (await directus.request(
			readItems('project_stock_ledger', {
				filter: { project_id: { _eq: pIdNum } },
				fields: [
					'id',
					'item_id',
					'transaction_type',
					'quantity',
					'reference_type',
					'reference_no',
					'notes',
					'date_created'
				],
				sort: ['-date_created'],
				limit: 100
			})
		)) as any[];

		if (!ledgerRows || ledgerRows.length === 0) return [];

		// 2. Fetch master item info separately
		const itemIds = Array.from(new Set(ledgerRows.map((t) => t.item_id).filter(Boolean)));
		let itemMap = new Map<number, any>();

		if (itemIds.length > 0) {
			const masterItems = (await directus.request(
				readItems('identitas_barang', {
					filter: { id: { _in: itemIds } },
					fields: [
						'id',
						'nama_barang_lengkap',
						'satuan',
						'is_borrowable',
						'consumable',
						'tipe',
						'parent_category.parent_category',
						'sub_category.nama_sub'
					],
					limit: -1
				})
			)) as any[];
			masterItems.forEach((ib) => itemMap.set(ib.id, ib));
		}

		return ledgerRows.map((tx) => {
			const master = itemMap.get(Number(tx.item_id));
			const cat = determineItemCategory(master);
			const txType = tx.transaction_type || '';
			const isPositive = Number(tx.quantity) >= 0;

			let condStatus: ConditionStatus = 'dipakai';
			if (txType.includes('RECEIPT') || txType.includes('PURCHASE')) {
				condStatus = 'diterima';
			} else if (txType.includes('RETURN')) {
				condStatus = 'dikembalikan';
			} else if (txType.includes('LOST') || txType.includes('DAMAGED')) {
				condStatus = 'rusak';
			} else if (txType.includes('USAGE')) {
				condStatus = 'dipakai';
			}

			return {
				id: tx.id,
				date: (tx.date_created || '').slice(0, 16).replace('T', ' '),
				itemId: Number(tx.item_id),
				namaBarang: master?.nama_barang_lengkap || `Barang #${tx.item_id}`,
				satuan: master?.satuan || 'pcs',
				category: cat,
				type: isPositive ? 'IN' : 'OUT',
				conditionStatus: condStatus,
				qty: Math.abs(Number(tx.quantity)) || 0,
				suratJalanRef: tx.reference_no || null,
				notes: tx.notes || txType,
				source: tx.reference_type || 'Buku Besar Proyek',
				refNo: tx.reference_no || `TX-${tx.id}`
			};
		});
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Fetch active Surat Jalan list for auto-reference selection
 */
export async function getSuratJalanListForProject(projectId: number | string): Promise<SuratJalanOption[]> {
	const options: SuratJalanOption[] = [];
	try {
		// 1. Fetch SJI (Surat Jalan Internal)
		const sjiList = (await directus.request(
			readItems('sji_header' as any, {
				fields: ['id', 'reference_no', 'date_created', 'keperluan'],
				sort: ['-date_created'],
				limit: 20
			})
		)) as any[];

		if (Array.isArray(sjiList)) {
			sjiList.forEach((s) => {
				if (s.reference_no) {
					options.push({
						id: s.id,
						nomorSj: s.reference_no,
						tanggal: (s.date_created || '').slice(0, 10),
						tujuan: s.keperluan || 'SJI Site Transfer',
						tipe: 'SJI'
					});
				}
			});
		}

		// 2. Fetch SJ Manual
		const sjmList = (await directus.request(
			readItems('surat_jalan' as any, {
				// koleksi 'sj_manual' tidak ada: SJ Manual = surat_jalan.type='manual' (nama tujuan di baris pertama notes)
				filter: { type: { _eq: 'manual' } },
				fields: ['id', 'nomor_sj', 'date_created', 'notes', 'delivery_address'],
				sort: ['-date_created'],
				limit: 20
			})
		)) as any[];

		if (Array.isArray(sjmList)) {
			sjmList.forEach((s) => {
				if (s.nomor_sj) {
					options.push({
						id: s.id,
						nomorSj: s.nomor_sj,
						tanggal: (s.date_created || '').slice(0, 10),
						tujuan: /^\[SJ MANUAL\] Tujuan: (.*?) \| Telp:/.exec(String(s.notes || '').split('\n')[0])?.[1]?.trim() || s.delivery_address || 'SJM Manual',
						tipe: 'SJM'
					});
				}
			});
		}
	} catch (error) {
		console.warn('Non-critical error fetching Surat Jalan list:', error);
	}
	return options;
}

/**
 * Record stock movement for project site (Usage, Return, Loss/Damaged)
 * Dispatches to project ledger APIs and rebuilds project_stock_balance.
 */
export async function recordProjectStockMovement(payload: ProjectStockMovementPayload): Promise<{ success: boolean; id: number | string; refNo: string }> {
	const { projectId, itemId, movementType, conditionStatus, quantity, suratJalanRef, notes } = payload;
	const pIdNum = Number(projectId);

	if (!itemId || !quantity || quantity <= 0) {
		throw new Error('Item dan kuantitas valid wajib diisi');
	}

	const batchId = `site-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
	const refNo = suratJalanRef || `MUT-${Date.now()}`;

	try {
		if (conditionStatus === 'dikembalikan') {
			// Retur barang ke gudang
			const { reportReturn } = await import('$lib/services/projectTransferApi');
			await reportReturn({
				projectId: pIdNum,
				identitasBarangId: itemId,
				quantity,
				notes: notes || 'Retur dari lokasi proyek',
				batchId
			});
		} else if (conditionStatus === 'rusak' || conditionStatus === 'hilang') {
			// Kerugian / barang rusak di site
			const { reportLossClaim } = await import('$lib/services/projectLossClaimApi');
			await reportLossClaim({
				projectId: pIdNum,
				identitasBarangId: itemId,
				quantity,
				evidencePhoto: '', // Opsional bila dari panel cepat
				batchId
			});
		} else {
			// Pemakaian material harian di site (OUT-USAGE)
			const { reportUsageDeltas } = await import('$lib/services/projectUsageLedger');
			await reportUsageDeltas(pIdNum, null, batchId, [
				{ expenseId: batchId, identitasBarangId: itemId, delta: quantity }
			]);
		}

		// Trigger auto rebuild balance agar UI langsung mencerminkan data terbaru
		fetch('/api/inventory-proyek/rebuild-balance', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ projectId: pIdNum })
		}).catch(() => {});

		return {
			success: true,
			id: batchId,
			refNo
		};
	} catch (err: any) {
		console.error('[recordProjectStockMovement] Error recording movement:', err);
		throw new Error(err?.message || 'Gagal mencatat mutasi stok proyek');
	}
}
