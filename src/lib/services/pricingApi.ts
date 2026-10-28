// src/lib/services/pricingApi.ts
// Fase 5 — Quick Price Check (Multi-Tier Pricelist & Penajaman Modul
// Distributor v2). HANYA READ-ONLY: acuan tier/histori untuk sales di
// lapangan, BUKAN penawaran resmi. Auto-apply ke penawaran DITUNDA sampai
// Fase 3 admin (erp-epi) stabil — lihat dokumen rencana §Fase 5.
//
// Cascade di sini SENGAJA lebih sederhana dari sellingPriceEngine.js
// (erp-epi) — hanya level yang berguna untuk quick-check lapangan: tier
// customer_item > tier item > harga master > histori customer > histori
// global. Level lantai (floor) ditampilkan terpisah sebagai info, bukan
// bagian cascade (sales lapangan hanya perlu tahu, tidak perlu logic guard
// di sini — guard sebenarnya ada di modal SO erp-epi).
import directus from './directus';
import { readItems } from '@directus/sdk';

export interface ProdukOption {
	id: number;
	nama: string;
	harga_jual: number | null;
	harga_jual_floor: number | null;
}

export interface QuickPriceResult {
	hargaTier: number | null;
	tierLabel: string | null; // mis. "Distributor", "Wholesale/Industri"
	hargaMaster: number | null;
	hargaTerakhir: number | null;
	tanggalTerakhir: string | null;
	hargaRataRata: number | null;
	jumlahSO: number;
	lantai: number | null;
	sumber: 'customer_item' | 'tier_item' | 'harga_master' | 'histori' | 'tidak_ada';
}

/** Cari barang by nama (untuk search box Quick Price Check). Maks 15 hasil. */
export async function searchProdukForHarga(query: string): Promise<ProdukOption[]> {
	const q = (query || '').trim();
	if (q.length < 2) return [];
	const rows = (await directus.request(
		readItems('identitas_barang', {
			filter: { nama_barang_lengkap: { _icontains: q } },
			fields: ['id', 'nama_barang_lengkap', 'harga_jual', 'harga_jual_floor'],
			limit: 15
		})
	)) as any[];
	return rows.map((r) => ({
		id: r.id,
		nama: r.nama_barang_lengkap,
		harga_jual: r.harga_jual ?? null,
		harga_jual_floor: r.harga_jual_floor ?? null
	}));
}

/**
 * Ambil acuan harga untuk satu barang, opsional dipersempit ke satu customer.
 * READ-ONLY — tidak pernah menulis apa pun.
 */
export async function getQuickPrice(barangId: number, customerId?: number | null): Promise<QuickPriceResult> {
	const result: QuickPriceResult = {
		hargaTier: null,
		tierLabel: null,
		hargaMaster: null,
		hargaTerakhir: null,
		tanggalTerakhir: null,
		hargaRataRata: null,
		jumlahSO: 0,
		lantai: null,
		sumber: 'tidak_ada'
	};

	const barangRows = (await directus.request(
		readItems('identitas_barang', {
			filter: { id: { _eq: barangId } },
			fields: ['id', 'harga_jual', 'harga_jual_floor'],
			limit: 1
		})
	)) as any[];
	const barang = barangRows[0];
	if (!barang) return result;
	result.hargaMaster = barang.harga_jual ?? null;
	result.lantai = barang.harga_jual_floor ?? null;
	if (result.hargaMaster) result.sumber = 'harga_master';

	let kodeCustomer: string | null = null;
	let jenisCustomer: string | null = null;
	if (customerId) {
		const custRows = (await directus.request(
			readItems('master_customer', {
				filter: { id: { _eq: customerId } },
				fields: ['id', 'kode_customer', 'jenis_customer'],
				limit: 1
			})
		)) as any[];
		kodeCustomer = custRows[0]?.kode_customer ?? null;
		jenisCustomer = custRows[0]?.jenis_customer ?? null;
	}

	// Tier customer_item (harga kontrak khusus) — paling spesifik.
	if (customerId) {
		const cip = (await directus.request(
			readItems('pricing_tier_price', {
				filter: {
					scope: { _eq: 'customer_item' },
					scope_id: { _eq: customerId },
					scope_id2: { _eq: barangId },
					aktif: { _eq: true }
				},
				fields: ['harga_net', 'berlaku_mulai', 'berlaku_sampai'],
				limit: 1
			})
		)) as any[];
		const row = cip.find((r) => isBerlakuHariIni(r.berlaku_mulai, r.berlaku_sampai));
		if (row) {
			result.hargaTier = row.harga_net;
			result.tierLabel = 'Kontrak Khusus';
			result.sumber = 'customer_item';
		}
	}

	// Tier item (berdasarkan jenis_customer) — kalau belum ketemu customer_item.
	if (!result.hargaTier && jenisCustomer) {
		const tiers = (await directus.request(
			readItems('pricing_tier', {
				filter: { jenis_customer_match: { _eq: jenisCustomer }, aktif: { _eq: true } },
				fields: ['id', 'nama_tier'],
				limit: 1
			})
		)) as any[];
		const tier = tiers[0];
		if (tier) {
			const tip = (await directus.request(
				readItems('pricing_tier_price', {
					filter: {
						scope: { _eq: 'item' },
						scope_id: { _eq: barangId },
						tier_id: { _eq: tier.id },
						aktif: { _eq: true }
					},
					fields: ['harga_net', 'berlaku_mulai', 'berlaku_sampai'],
					limit: 5
				})
			)) as any[];
			const row = tip.find((r) => isBerlakuHariIni(r.berlaku_mulai, r.berlaku_sampai));
			if (row) {
				result.hargaTier = row.harga_net;
				result.tierLabel = tier.nama_tier;
				result.sumber = 'tier_item';
			}
		}
	}

	// Histori: terakhir & rata-rata (per customer kalau ada, else global) — 12 bulan.
	const cutoff = new Date();
	cutoff.setMonth(cutoff.getMonth() - 12);
	const cutoffIso = cutoff.toISOString().slice(0, 10);
	const filter: any = {
		product_id: { _eq: barangId },
		harga_satuan: { _gt: 0 },
		date_created: { _gte: cutoffIso }
	};
	// Histori khusus customer ini kalau kode_customer diketahui (lewat so_customer_id.kode_customer).
	const detRows = (await directus.request(
		readItems('so_customer_details', {
			filter,
			fields: kodeCustomer
				? ['harga_satuan', 'date_created', { so_customer_id: ['kode_customer'] } as any]
				: ['harga_satuan', 'date_created'],
			sort: ['-date_created'],
			limit: 200
		})
	)) as any[];

	const relevan = kodeCustomer ? detRows.filter((r) => r?.so_customer_id?.kode_customer === kodeCustomer) : detRows;
	if (relevan.length > 0) {
		result.hargaTerakhir = relevan[0].harga_satuan;
		result.tanggalTerakhir = relevan[0].date_created;
		result.jumlahSO = relevan.length;
		result.hargaRataRata = Math.round(relevan.reduce((s, r) => s + Number(r.harga_satuan), 0) / relevan.length);
		if (result.sumber === 'tidak_ada' || result.sumber === 'harga_master') {
			if (!result.hargaTier) result.sumber = 'histori';
		}
	}

	if (!result.hargaTier && !result.hargaMaster && relevan.length === 0) result.sumber = 'tidak_ada';

	return result;
}

function isBerlakuHariIni(mulai?: string | null, sampai?: string | null): boolean {
	const today = new Date().toISOString().slice(0, 10);
	if (mulai && mulai > today) return false;
	if (sampai && sampai < today) return false;
	return true;
}

/** 3 pembelian terakhir customer ini (barang apapun) — untuk badge di halaman detail customer. */
export async function getRecentPurchasesForCustomer(kodeCustomer: string, limit = 3) {
	if (!kodeCustomer) return [];
	const soRows = (await directus.request(
		readItems('so_customer', {
			filter: { kode_customer: { _eq: kodeCustomer } },
			fields: ['id', 'nomor_so', 'tanggal_so'],
			sort: ['-tanggal_so'],
			limit: 5
		})
	)) as any[];
	if (soRows.length === 0) return [];
	const soIds = soRows.map((s) => s.id);
	const detRows = (await directus.request(
		readItems('so_customer_details', {
			filter: { so_customer_id: { _in: soIds }, harga_satuan: { _gt: 0 } },
			fields: ['nama_barang', 'harga_satuan', 'qty', 'date_created', 'so_customer_id'],
			sort: ['-date_created'],
			limit
		})
	)) as any[];
	const soMap = new Map(soRows.map((s) => [s.id, s]));
	return detRows.map((d) => ({
		nama_barang: d.nama_barang,
		harga_satuan: d.harga_satuan,
		qty: d.qty,
		nomor_so: soMap.get(d.so_customer_id)?.nomor_so || null,
		tanggal: d.date_created
	}));
}

/** Badge tier customer untuk halaman detail. */
export async function getCustomerTierLabel(jenisCustomer?: string | null): Promise<string | null> {
	if (!jenisCustomer) return null;
	const rows = (await directus.request(
		readItems('pricing_tier', {
			filter: { jenis_customer_match: { _eq: jenisCustomer }, aktif: { _eq: true } },
			fields: ['nama_tier'],
			limit: 1
		})
	)) as any[];
	return rows[0]?.nama_tier ?? null;
}

/** Satu panggilan: jenis_customer + label tier-nya, untuk badge di halaman detail customer. */
export async function getCustomerJenisAndTier(customerId: number): Promise<{ jenisCustomer: string | null; tierLabel: string | null }> {
	const rows = (await directus.request(
		readItems('master_customer', {
			filter: { id: { _eq: customerId } },
			fields: ['jenis_customer'],
			limit: 1
		})
	)) as any[];
	const jenisCustomer = rows[0]?.jenis_customer ?? null;
	const tierLabel = await getCustomerTierLabel(jenisCustomer);
	return { jenisCustomer, tierLabel };
}
