// src/lib/services/spkDailyLogApi.ts
// Input & Monitoring Produksi Harian (Fase 7, Pertajam KPI Marketing & Manufaktur v2).
// Menulis ke spk_daily_log — TIDAK menyentuh spk.actual_quantity_produced,
// yang tetap nilai final sekali-isi dari alur QC/Finished Goods di erp-epi-1.
//
// Relasi Directus dipisahkan (separated fetching) sesuai standar arsitektur:
// 1. Fetch spk / spk_daily_log
// 2. Kumpulkan FK (product_id, spk_id)
// 3. Fetch identitas_barang / spk secara terpisah lalu gabungkan di memori.

import directus, { handleDirectusError } from './directus';
import { readItems, createItem } from '@directus/sdk';

const COLLECTION = 'spk_daily_log';

export interface SpkProductInfo {
	id: number;
	nama_barang_lengkap?: string | null;
	kode_barang?: string | null;
	satuan?: string | null;
}

export interface ActiveSpk {
	id: number;
	nomor: string;
	batch_no: string | null;
	status?: string;
	product_id: SpkProductInfo | number | null;
	total_kg?: number | null;
	jumlah_produksi?: number | null;
	actual_quantity_produced?: number | null;
	production_deadline?: string | null;
	target_selesai?: string | null;
	date_created?: string | null;
}

export interface SpkDailyLogRow {
	id: number;
	client_txn_id?: string | null;
	spk_id: number | ActiveSpk;
	tanggal: string;
	output_kg: number | null;
	reject_kg: number | null;
	waste_kg: number | null;
	catatan?: string | null;
	input_by?: string | null;
	date_created?: string | null;
}

export interface ProductionStats {
	activeSpkCount: number;
	outputHariIniKg: number;
	rejectHariIniKg: number;
	wasteHariIniKg: number;
	outputBulanIniKg: number;
}

/** Helper: Fetch identitas_barang terpisah untuk daftar product_id */
async function fetchProductsMap(productIds: number[]): Promise<Map<number, SpkProductInfo>> {
	const map = new Map<number, SpkProductInfo>();
	const validIds = Array.from(new Set(productIds.filter((id) => typeof id === 'number' && id > 0)));
	if (validIds.length === 0) return map;

	try {
		const items = (await directus.request(
			readItems('identitas_barang' as any, {
				filter: { id: { _in: validIds } } as any,
				fields: ['id', 'nama_barang_lengkap', 'kode_item', 'satuan'],
				limit: -1
			})
		)) as any[];

		for (const item of items) {
			map.set(item.id, {
				id: item.id,
				nama_barang_lengkap: item.nama_barang_lengkap || null,
				kode_barang: item.kode_item || null,
				satuan: item.satuan || null
			});
		}
	} catch (err) {
		console.warn('[spkDailyLogApi] Gagal memuat identitas_barang terpisah:', err);
	}
	return map;
}

/** SPK yang sedang berjalan (status in_progress) — kandidat untuk input harian & monitoring aktif. */
export async function fetchActiveSpkList(): Promise<ActiveSpk[]> {
	try {
		const spkRows = (await directus.request(
			readItems('spk' as any, {
				filter: { status: { _eq: 'in_progress' } } as any,
				fields: [
					'id',
					'nomor',
					'batch_no',
					'status',
					'product_id',
					'total_kg',
					'jumlah_produksi',
					'actual_quantity_produced',
					'production_deadline',
					'date_created'
				],
				sort: ['-date_created'],
				limit: -1
			})
		)) as any[];

		if (!spkRows || spkRows.length === 0) return [];

		// Relasi dipisah: kumpulkan product_id
		const productIds = spkRows
			.map((s) => (typeof s.product_id === 'object' && s.product_id ? s.product_id.id : s.product_id))
			.filter((id): id is number => typeof id === 'number' && id > 0);

		const productMap = await fetchProductsMap(productIds);

		return spkRows.map((s) => {
			const rawProdId = typeof s.product_id === 'object' && s.product_id ? s.product_id.id : s.product_id;
			const productInfo = typeof rawProdId === 'number' ? productMap.get(rawProdId) || null : null;
			return {
				...s,
				product_id: productInfo || (typeof s.product_id === 'object' ? s.product_id : { id: rawProdId, nama_barang_lengkap: null })
			};
		});
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

/**
 * Rantai Bahan SPK v2, Fase 4.3 (2 Sep 2026) — SPK berstatus waiting_for_stock, untuk
 * bagian "⏳ Menunggu Bahan" di beranda /produksi. Sama pola dengan fetchActiveSpkList.
 */
export async function fetchWaitingForStockSpkList(): Promise<ActiveSpk[]> {
	try {
		const spkRows = (await directus.request(
			readItems('spk' as any, {
				filter: { status: { _eq: 'waiting_for_stock' } } as any,
				fields: [
					'id',
					'nomor',
					'batch_no',
					'status',
					'product_id',
					'total_kg',
					'jumlah_produksi',
					'production_deadline',
					'date_created'
				],
				sort: ['-date_created'],
				limit: -1
			})
		)) as any[];

		if (!spkRows || spkRows.length === 0) return [];

		const productIds = spkRows
			.map((s) => (typeof s.product_id === 'object' && s.product_id ? s.product_id.id : s.product_id))
			.filter((id): id is number => typeof id === 'number' && id > 0);

		const productMap = await fetchProductsMap(productIds);

		return spkRows.map((s) => {
			const rawProdId = typeof s.product_id === 'object' && s.product_id ? s.product_id.id : s.product_id;
			const productInfo = typeof rawProdId === 'number' ? productMap.get(rawProdId) || null : null;
			return {
				...s,
				product_id: productInfo || (typeof s.product_id === 'object' ? s.product_id : { id: rawProdId, nama_barang_lengkap: null })
			};
		});
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

/** Daftar semua SPK dengan filter status opsional (untuk tab monitoring/riwayat) */
export async function fetchAllSpkList(statusFilter?: string): Promise<ActiveSpk[]> {
	try {
		const filter: any = {};
		if (statusFilter && statusFilter !== 'all') {
			filter.status = { _eq: statusFilter };
		}

		const spkRows = (await directus.request(
			readItems('spk' as any, {
				filter,
				fields: [
					'id',
					'nomor',
					'batch_no',
					'status',
					'product_id',
					'total_kg',
					'jumlah_produksi',
					'actual_quantity_produced',
					'production_deadline',
					'date_created'
				],
				sort: ['-date_created'],
				limit: 100
			})
		)) as any[];

		if (!spkRows || spkRows.length === 0) return [];

		const productIds = spkRows
			.map((s) => (typeof s.product_id === 'object' && s.product_id ? s.product_id.id : s.product_id))
			.filter((id): id is number => typeof id === 'number' && id > 0);

		const productMap = await fetchProductsMap(productIds);

		return spkRows.map((s) => {
			const rawProdId = typeof s.product_id === 'object' && s.product_id ? s.product_id.id : s.product_id;
			const productInfo = typeof rawProdId === 'number' ? productMap.get(rawProdId) || null : null;
			return {
				...s,
				product_id: productInfo || (typeof s.product_id === 'object' ? s.product_id : { id: rawProdId, nama_barang_lengkap: null })
			};
		});
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export interface CreateDailyLogParams {
	clientTxnId: string;
	spkId: number;
	tanggal: string; // YYYY-MM-DD
	outputKg: number | null;
	rejectKg: number | null;
	wasteKg: number | null;
	catatan?: string | null;
	inputBy?: string | null;
}

export async function createDailyLog(params: CreateDailyLogParams) {
	const { clientTxnId, spkId, tanggal, outputKg, rejectKg, wasteKg, catatan, inputBy } = params;
	try {
		return await directus.request(
			createItem(COLLECTION as any, {
				client_txn_id: clientTxnId,
				spk_id: spkId,
				tanggal,
				output_kg: outputKg,
				reject_kg: rejectKg,
				waste_kg: wasteKg,
				catatan: catatan || null,
				input_by: inputBy || null
			} as any)
		);
	} catch (err) {
		handleDirectusError(err);
		throw err;
	}
}

/** Log terbaru untuk 1 SPK — ditampilkan di bawah form supaya operator lihat riwayat input. */
export async function fetchRecentDailyLogs(spkId: number, limit = 10): Promise<SpkDailyLogRow[]> {
	try {
		return (await directus.request(
			readItems(COLLECTION as any, {
				filter: { spk_id: { _eq: spkId } } as any,
				sort: ['-tanggal', '-date_created'],
				limit
			})
		)) as any[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

/** Ambil seluruh log harian dengan relasi spk & identitas_barang yang dipisah */
export async function fetchAllDailyLogs(options?: {
	spkId?: number;
	tanggal?: string;
	limit?: number;
}): Promise<SpkDailyLogRow[]> {
	try {
		const filter: any = {};
		if (options?.spkId) {
			filter.spk_id = { _eq: options.spkId };
		}
		if (options?.tanggal) {
			filter.tanggal = { _eq: options.tanggal };
		}

		const logs = (await directus.request(
			readItems(COLLECTION as any, {
				filter,
				sort: ['-tanggal', '-date_created'],
				limit: options?.limit || 150
			})
		)) as any[];

		if (!logs || logs.length === 0) return [];

		// Ambil data SPK terkait secara terpisah
		const spkIds = Array.from(
			new Set(
				logs
					.map((l) => (typeof l.spk_id === 'object' && l.spk_id ? l.spk_id.id : l.spk_id))
					.filter((id): id is number => typeof id === 'number' && id > 0)
			)
		);

		const spkMap = new Map<number, ActiveSpk>();
		if (spkIds.length > 0) {
			const spkRows = (await directus.request(
				readItems('spk' as any, {
					filter: { id: { _in: spkIds } } as any,
					fields: ['id', 'nomor', 'batch_no', 'status', 'product_id', 'total_kg', 'jumlah_produksi'],
					limit: -1
				})
			)) as any[];

			const productIds = spkRows
				.map((s) => (typeof s.product_id === 'object' && s.product_id ? s.product_id.id : s.product_id))
				.filter((id): id is number => typeof id === 'number' && id > 0);

			const productMap = await fetchProductsMap(productIds);

			for (const s of spkRows) {
				const rawProdId = typeof s.product_id === 'object' && s.product_id ? s.product_id.id : s.product_id;
				const prodInfo = typeof rawProdId === 'number' ? productMap.get(rawProdId) || null : null;
				spkMap.set(s.id, {
					...s,
					product_id: prodInfo || { id: rawProdId, nama_barang_lengkap: null }
				});
			}
		}

		return logs.map((l) => {
			const sId = typeof l.spk_id === 'object' && l.spk_id ? l.spk_id.id : l.spk_id;
			const spkObj = typeof sId === 'number' ? spkMap.get(sId) || null : null;
			return {
				...l,
				spk_id: spkObj || (typeof l.spk_id === 'object' ? l.spk_id : { id: sId, nomor: `#${sId}` })
			};
		});
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

/** Ambil statistik ringkasan produksi untuk card metrik */
export async function fetchProductionStats(): Promise<ProductionStats> {
	const todayStr = new Date().toISOString().slice(0, 10);
	const startOfMonth = todayStr.slice(0, 7) + '-01';

	let activeSpkCount = 0;
	let outputHariIniKg = 0;
	let rejectHariIniKg = 0;
	let wasteHariIniKg = 0;
	let outputBulanIniKg = 0;

	try {
		// 1. SPK aktif
		const activeSpks = (await directus.request(
			readItems('spk' as any, {
				filter: { status: { _eq: 'in_progress' } } as any,
				fields: ['id'],
				limit: -1
			})
		)) as any[];
		activeSpkCount = activeSpks?.length || 0;
	} catch (e) {
		console.warn('[spkDailyLogApi] Gagal hitung active SPKs:', e);
	}

	try {
		// 2. Log harian bulan ini
		const logs = (await directus.request(
			readItems(COLLECTION as any, {
				filter: { tanggal: { _gte: startOfMonth } } as any,
				fields: ['tanggal', 'output_kg', 'reject_kg', 'waste_kg'],
				limit: -1
			})
		)) as any[];

		if (logs && logs.length > 0) {
			for (const row of logs) {
				const out = Number(row.output_kg) || 0;
				const rej = Number(row.reject_kg) || 0;
				const wst = Number(row.waste_kg) || 0;

				outputBulanIniKg += out;

				if (row.tanggal === todayStr) {
					outputHariIniKg += out;
					rejectHariIniKg += rej;
					wasteHariIniKg += wst;
				}
			}
		}
	} catch (e) {
		console.warn('[spkDailyLogApi] Gagal hitung statistik logs harian:', e);
	}

	return {
		activeSpkCount,
		outputHariIniKg: Number(outputHariIniKg.toFixed(1)),
		rejectHariIniKg: Number(rejectHariIniKg.toFixed(1)),
		wasteHariIniKg: Number(wasteHariIniKg.toFixed(1)),
		outputBulanIniKg: Number(outputBulanIniKg.toFixed(1))
	};
}
