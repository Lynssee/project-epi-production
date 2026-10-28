// src/lib/services/rndMixing.ts
// Rekomendasi Tambahan #2 (Pertajam Modul R&D v2, 3 Sep 2026) — Kalkulator Campuran lapangan.
// Pola sama dengan rndField.ts: direct readItems via @directus/sdk lewat proxy /api/directus/*.
//
// PENTING (batas rahasia dagang, sama seperti rndField.ts): fields yang diminta di sini
// HANYA rasio komponen (mixing_ratio_type/value, sg) — TIDAK PERNAH `supplier`/`presentase`
// (JSON komposisi bahan baku per formula). Jangan tambah field itu ke query manapun di file ini.
//
// FIX (Fase 4, Modul Foxapaint Terpusat v2, 4 Sep 2026): filter semula memakai
// `kode_fg_id` — kolom itu TIDAK ADA di template_formula (403 dari Directus, bukan izin —
// lihat aturan schema-drift di CLAUDE.md). Relasi produk jadi yang benar adalah
// `kode_template` (m2o -> kode_fg), sudah didokumentasikan di formulaCoverageApi.js:7
// (erp-epi) dan §2 dokumen rencana Foxapaint Terpusat v2. Diverifikasi live terhadap
// Directus produksi sebelum diperbaiki.

import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';

export interface FormulaRatio {
	id: number;
	nama_template: string;
	kode_fg_nama: string;
	version: number;
	mixing_ratio_type: string;
	mixing_ratio_value: string;
	sg: number | null;
}

/** Cari formula RELEASED (siap produksi) berdasarkan nama produk (kode_fg). */
export async function searchFormulaRatios(query: string): Promise<FormulaRatio[]> {
	if (!query || query.trim().length < 2) return [];
	try {
		const rows = (await directus.request(
			readItems('template_formula', {
				filter: {
					status: { _eq: 'released' },
					kode_template: { nama_kode: { _icontains: query.trim() } }
				},
				fields: ['id', 'nama_template', 'version', 'mixing_ratio_type', 'mixing_ratio_value', 'sg', 'kode_template.nama_kode'],
				sort: ['kode_template.nama_kode'],
				limit: 15
			})
		)) as any[];
		return rows.map((r) => ({
			id: r.id,
			nama_template: r.nama_template,
			kode_fg_nama: r.kode_template?.nama_kode || '-',
			version: r.version,
			mixing_ratio_type: r.mixing_ratio_type || 'by_weight',
			mixing_ratio_value: r.mixing_ratio_value || '1',
			sg: r.sg ?? null
		}));
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}
