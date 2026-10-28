// src/lib/services/assetOwnership.ts
// Fase 6 (Penajaman Aset Produktif — ROI/TCO, 29 Agu 2026): Kartu ringkas Biaya
// Kepemilikan (TCO) untuk dashboard lapangan. TANPA revenue/profit — itu data sensitif
// yang sengaja tidak diturunkan ke lapangan (lihat implementation plan §6.1).
//
// Sumber data SAMA dengan admin (erp-epi-1/equipmentAnalyticsApi.js getAssetOwnershipCostReport):
// equipment.identitas_barang_id -> identitas_barang.harga_beli/tanggal_pembelian (Fase 0),
// work_order.biaya_* terstruktur (Fase 1), asset_depreciation_config per kategori (Fase 0.4).
// Dua repo tidak berbagi lib — logikanya diduplikasi di sini secara ringkas, jangan diubah
// tanpa menyamakan juga di sisi admin.
import directus from './directus';
import { readItem, readItems } from '@directus/sdk';

export interface AssetOwnershipSummary {
	equipmentId: string;
	hargaBeli: number;
	hargaBeliKosong: boolean;
	tanggalPembelian: string | null;
	totalBiaya: number;
	woCount: number;
	rasioPct: number | null;
	statusLevel: 'aman' | 'peringatan' | 'kritis' | null;
	ambangPeringatanPct: number;
	ambangKritisPct: number;
	umurManfaatTahun: number | null;
	sisaUmurTahun: number | null;
}

const DEFAULT_CONFIG = { ambang_peringatan_pct: 30, ambang_kritis_pct: 60, umur_manfaat_tahun: null as number | null };

export async function getAssetOwnershipSummary(equipmentId: string): Promise<AssetOwnershipSummary | null> {
	try {
		const [equipment, workOrders, configRows] = await Promise.all([
			directus.request(
				readItem('equipment', equipmentId, {
					fields: ['id', 'parent_category', 'identitas_barang_id.harga_beli', 'identitas_barang_id.tanggal_pembelian']
				})
			) as Promise<any>,
			directus.request(
				readItems('work_order' as any, {
					filter: { equipment_id: { _eq: equipmentId } },
					fields: ['biaya_sparepart', 'biaya_jasa_internal', 'biaya_jasa_eksternal', 'biaya_lainnya', 'biaya_status'],
					limit: -1
				})
			) as Promise<any[]>,
			directus.request(
				readItems('asset_depreciation_config' as any, {
					filter: { aktif: { _eq: true } },
					fields: ['kategori_equipment', 'ambang_peringatan_pct', 'ambang_kritis_pct', 'umur_manfaat_tahun']
				})
			) as Promise<any[]>
		]);

		if (!equipment) return null;

		const configByCategory = new Map(configRows.map((c) => [c.kategori_equipment, c]));
		const config = configByCategory.get(equipment.parent_category) || configByCategory.get('EQUIPMENT') || DEFAULT_CONFIG;

		let totalBiaya = 0;
		let woCount = 0;
		for (const w of workOrders) {
			// WO belum dimigrasi/diverifikasi (biaya_status null) dilewati — sama seperti admin,
			// bukan ditebak dari teks (repo ini tidak menduplikasi parser legacy).
			if (!w.biaya_status) continue;
			totalBiaya +=
				(Number(w.biaya_sparepart) || 0) +
				(Number(w.biaya_jasa_internal) || 0) +
				(Number(w.biaya_jasa_eksternal) || 0) +
				(Number(w.biaya_lainnya) || 0);
			woCount += 1;
		}

		const hargaBeli = equipment.identitas_barang_id?.harga_beli || 0;
		const hargaBeliKosong = !hargaBeli || hargaBeli <= 0;
		const rasioPct = hargaBeliKosong ? null : (totalBiaya / hargaBeli) * 100;

		let statusLevel: AssetOwnershipSummary['statusLevel'] = null;
		if (!hargaBeliKosong && rasioPct !== null) {
			if (rasioPct >= (config.ambang_kritis_pct ?? 60)) statusLevel = 'kritis';
			else if (rasioPct >= (config.ambang_peringatan_pct ?? 30)) statusLevel = 'peringatan';
			else statusLevel = 'aman';
		}

		const tanggalPembelian = equipment.identitas_barang_id?.tanggal_pembelian || null;
		const umurManfaatTahun = config.umur_manfaat_tahun ?? null;
		let sisaUmurTahun: number | null = null;
		if (tanggalPembelian && umurManfaatTahun) {
			const beliDate = new Date(tanggalPembelian);
			const umurTerpakai = (Date.now() - beliDate.getTime()) / (365.25 * 86400000);
			sisaUmurTahun = umurManfaatTahun - umurTerpakai;
		}

		return {
			equipmentId,
			hargaBeli,
			hargaBeliKosong,
			tanggalPembelian,
			totalBiaya,
			woCount,
			rasioPct,
			statusLevel,
			ambangPeringatanPct: config.ambang_peringatan_pct ?? 30,
			ambangKritisPct: config.ambang_kritis_pct ?? 60,
			umurManfaatTahun,
			sisaUmurTahun
		};
	} catch (error) {
		console.error('[assetOwnership] getAssetOwnershipSummary error:', error);
		return null;
	}
}

/**
 * Fase 6.3 (Penajaman Aset Produktif, 29 Agu 2026): versi BATCH untuk badge di daftar alat
 * (mis. /preventive — ratusan equipment sekaligus). ~3 query total, BUKAN per-baris — daftar
 * alat sengaja tidak dipanggil per-item supaya tidak N+1 di jaringan lapangan yang lemah
 * (lihat catatan kenapa 6.3 sempat ditunda). Aset tanpa harga_beli TIDAK masuk peta hasil
 * (bukan 0) — pemanggil harus treat "tidak ada entry" sebagai "belum bisa dihitung".
 */
export async function getAssetOwnershipSummaryBatch(): Promise<Map<string, { totalBiaya: number; woCount: number; rasioPct: number; statusLevel: 'aman' | 'peringatan' | 'kritis' }>> {
	const result = new Map<string, { totalBiaya: number; woCount: number; rasioPct: number; statusLevel: 'aman' | 'peringatan' | 'kritis' }>();
	try {
		const [equipmentRows, workOrders, configRows] = await Promise.all([
			directus.request(
				readItems('equipment', {
					fields: ['id', 'parent_category', 'identitas_barang_id.harga_beli'],
					limit: -1
				})
			) as Promise<any[]>,
			directus.request(
				readItems('work_order' as any, {
					filter: { equipment_id: { _nnull: true }, biaya_status: { _nnull: true } },
					fields: ['equipment_id', 'biaya_sparepart', 'biaya_jasa_internal', 'biaya_jasa_eksternal', 'biaya_lainnya'],
					limit: -1
				})
			) as Promise<any[]>,
			directus.request(
				readItems('asset_depreciation_config' as any, {
					filter: { aktif: { _eq: true } },
					fields: ['kategori_equipment', 'ambang_peringatan_pct', 'ambang_kritis_pct']
				})
			) as Promise<any[]>
		]);

		const costByEquipment = new Map<string, { totalBiaya: number; woCount: number }>();
		for (const w of workOrders) {
			const eqId = w.equipment_id;
			if (!eqId) continue;
			const entry = costByEquipment.get(eqId) || { totalBiaya: 0, woCount: 0 };
			entry.totalBiaya +=
				(Number(w.biaya_sparepart) || 0) +
				(Number(w.biaya_jasa_internal) || 0) +
				(Number(w.biaya_jasa_eksternal) || 0) +
				(Number(w.biaya_lainnya) || 0);
			entry.woCount += 1;
			costByEquipment.set(eqId, entry);
		}

		const configByCategory = new Map(configRows.map((c) => [c.kategori_equipment, c]));
		const defaultConfig = configByCategory.get('EQUIPMENT') || DEFAULT_CONFIG;

		for (const eq of equipmentRows) {
			const hargaBeli = eq.identitas_barang_id?.harga_beli || 0;
			if (!hargaBeli || hargaBeli <= 0) continue; // belum bisa dihitung -> tidak masuk peta
			const cost = costByEquipment.get(eq.id) || { totalBiaya: 0, woCount: 0 };
			const rasioPct = (cost.totalBiaya / hargaBeli) * 100;
			const config = configByCategory.get(eq.parent_category) || defaultConfig;
			let statusLevel: 'aman' | 'peringatan' | 'kritis' = 'aman';
			if (rasioPct >= (config.ambang_kritis_pct ?? 60)) statusLevel = 'kritis';
			else if (rasioPct >= (config.ambang_peringatan_pct ?? 30)) statusLevel = 'peringatan';
			result.set(eq.id, { totalBiaya: cost.totalBiaya, woCount: cost.woCount, rasioPct, statusLevel });
		}
	} catch (error) {
		console.error('[assetOwnership] getAssetOwnershipSummaryBatch error:', error);
	}
	return result;
}

export interface SparepartStockOption {
	id: string;
	nama: string;
	code: string | null;
	unitCategoryId: string | null;
	qtyStock: number;
	lastPrice: number;
}

/**
 * Pusat Maintenance v2 Fase 4 (14 Sep 2026): cari part dari STOK GUDANG (koleksi
 * `sparepart`) — menggantikan `searchSparepartOptions` (Master Barang/identitas_barang,
 * Fase 6.2) supaya pemakaian bisa dicatat resmi ke sparepart_usage_log (G_WO4) dan
 * potong stok nyata bisa terjadi di admin. `lastPrice` dipakai HANYA untuk hitung
 * biaya_sparepart WO di background — TIDAK ditampilkan ke mekanik (Q2, kebijakan
 * "tanpa nominal Rupiah" yang sudah berlaku sejak 4 Sep 2026).
 */
export async function searchSparepartStockOptions(query: string, limit = 20): Promise<SparepartStockOption[]> {
	if (!query || query.trim().length < 2) return [];
	try {
		const rows = (await directus.request(
			readItems('sparepart' as any, {
				filter: { name: { _icontains: query.trim() } },
				fields: ['id', 'name', 'code', 'unit', 'qty_stock', 'last_price'],
				limit
			})
		)) as any[];
		return rows.map((r) => ({
			id: r.id,
			nama: r.name,
			code: r.code || null,
			unitCategoryId: r.unit || null,
			qtyStock: Number(r.qty_stock) || 0,
			lastPrice: Number(r.last_price) || 0
		}));
	} catch (error) {
		console.error('[assetOwnership] searchSparepartStockOptions error:', error);
		return [];
	}
}
