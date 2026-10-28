// src/lib/services/foxapaintApi.ts
// Fase 4 — Modul Foxapaint Terpusat v2 (docs/(eh) implementation_plan_Modul Foxapaint
// Terpusat — Product 360° Hub.md), referensi lapangan di project-epi.
//
// Grain = kode_fg (produk jadi), sama dengan erp-epi-1. Sumber data LANGSUNG Directus
// proxy (bukan lewat endpoint erp-epi-1) — lapangan tidak boleh mati kalau server admin
// mati (§Fase 4 dokumen rencana). Pola sama dengan rndField.ts/rndMixing.ts: direct
// readItems via @directus/sdk lewat proxy /api/directus/*.

import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';
import { detectPresetSpec } from '$lib/data/foxapaintPresets';

export interface FoxapaintCard {
	kodeFgId: number;
	namaKode: string;
	kodeSingkat: string | null;
	kategoriQc: string | null;
	spec: {
		product_category: string | null;
		resin_type: string | null;
		recommended_use: string | null;
		application_method: string[] | null;
		surface_preparation: string | null;
		storage_conditions: string | null;
		shelf_life_months: number | null;
		thinner_type: string | null;
		thinning_ratio: string | null;
		overcoating_min_hours: number | null;
		overcoating_max_hours: number | null;
		flash_point_celsius: number | null;
		coverage_sqm_per_liter: number | null;
		sumber_data: string | null;
	} | null;
	tds: { tds_url: string | null; tds_version: string | null; msds_url: string | null; msds_version: string | null } | null;
}

async function buildCard(kodeFg: { id: number; nama_kode: string; kode_singkat: string | null; kategori_qc: string | null }): Promise<FoxapaintCard> {
	const [specRows, tdsRows] = await Promise.all([
		directus.request(
			readItems('foxapaint_product_specs', {
				filter: { kode_fg_id: { _eq: kodeFg.id } },
				fields: [
					'product_category', 'resin_type', 'recommended_use', 'application_method',
					'surface_preparation', 'storage_conditions', 'shelf_life_months',
					'thinner_type', 'thinning_ratio', 'overcoating_min_hours', 'overcoating_max_hours',
					'flash_point_celsius', 'coverage_sqm_per_liter', 'sumber_data'
				],
				limit: 1
			})
		) as Promise<any[]>,
		directus.request(
			readItems('tds_msds_documents', {
				filter: { kode_fg_id: { _eq: kodeFg.id }, category: { _eq: 'produk_cat' } },
				fields: ['tds_url', 'tds_version', 'msds_url', 'msds_version'],
				limit: 1
			})
		) as Promise<any[]>
	]);

	// Fallback cerdas: jika belum tercatat di Directus, gunakan preset rekomendasi kimiawi Foxapaint
	const spec = specRows[0] || detectPresetSpec(kodeFg.nama_kode, kodeFg.kategori_qc);

	return {
		kodeFgId: kodeFg.id,
		namaKode: kodeFg.nama_kode,
		kodeSingkat: kodeFg.kode_singkat,
		kategoriQc: kodeFg.kategori_qc,
		spec,
		tds: tdsRows[0] || null
	};
}

/** Cari produk (grain kode_fg) untuk Katalog Ringkas / autocomplete lapangan. */
export async function searchFoxapaintProducts(query: string): Promise<FoxapaintCard[]> {
	if (!query || query.trim().length < 2) return [];
	try {
		const rows = (await directus.request(
			readItems('kode_fg', {
				filter: { nama_kode: { _icontains: query.trim() } },
				fields: ['id', 'nama_kode', 'kode_singkat', 'kategori_qc'],
				sort: ['nama_kode'],
				limit: 15
			})
		)) as any[];
		return Promise.all(rows.map(buildCard));
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

/** Kartu produk lengkap dari satu kode_fg — dipakai setelah pilih dari katalog/hasil scan. */
export async function fetchFoxapaintCard(kodeFgId: number): Promise<FoxapaintCard | null> {
	try {
		const rows = (await directus.request(
			readItems('kode_fg', {
				filter: { id: { _eq: kodeFgId } },
				fields: ['id', 'nama_kode', 'kode_singkat', 'kategori_qc'],
				limit: 1
			})
		)) as any[];
		if (!rows[0]) return null;
		return buildCard(rows[0]);
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

/**
 * Resolusi hasil scan QR EPI:ITEM:<id> (varian kemasan / identitas_barang) ke kode_fg —
 * satu drum discan, kartu produk jadi yang terbuka.
 */
export async function resolveKodeFgFromItemId(itemId: number): Promise<FoxapaintCard | null> {
	try {
		const rows = (await directus.request(
			readItems('identitas_barang', {
				filter: { id: { _eq: itemId } },
				fields: ['id', 'nama_barang_lengkap', 'kode_fg_id.id', 'kode_fg_id.nama_kode', 'kode_fg_id.kode_singkat', 'kode_fg_id.kategori_qc'],
				limit: 1
			})
		)) as any[];
		const kodeFg = rows[0]?.kode_fg_id;
		if (!kodeFg?.id) return null;
		return buildCard(kodeFg);
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

/**
 * Kalkulator kebutuhan cat: luas (m²) / daya sebar (m²/liter) + faktor loss.
 * Fungsi murni, tanpa I/O — bisa diuji unit tanpa Directus.
 */
export function calculatePaintNeed(
	areaSqm: number,
	coverageSqmPerLiter: number | null | undefined,
	lossFactorPct = 10
): { liters: number; coverageMissing: boolean } {
	if (!coverageSqmPerLiter || coverageSqmPerLiter <= 0) {
		return { liters: 0, coverageMissing: true };
	}
	const base = (areaSqm || 0) / coverageSqmPerLiter;
	const withLoss = base * (1 + (lossFactorPct || 0) / 100);
	return { liters: Math.round(withLoss * 100) / 100, coverageMissing: false };
}
