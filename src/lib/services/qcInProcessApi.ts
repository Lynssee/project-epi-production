// src/lib/services/qcInProcessApi.ts
// Fase 3A (Penajaman Modul Produksi v2, 26 Agu 2026) — In-Process QC: isi qc_results
// yang sudah ada (bukan bikin qc_inprocess_qc baru). qc_results.stage (tahap PRODUKSI:
// premix/grinding/letdown/tinting/final) berbeda dari qc_spec.tahap (metodologi QC:
// incoming/in_process/in_can/dst) -- keduanya sengaja terpisah, lihat catatan skema.
// Manfaat langsung: CoA & SpcChart.svelte (sudah ada di admin) langsung punya isi.

import directus, { handleDirectusError } from './directus';
import { readItems, createItem } from '@directus/sdk';

export type ProductionStage = 'premix' | 'grinding' | 'letdown' | 'tinting' | 'final';

export interface QcSpecRow {
	id: number;
	parameter: string;
	satuan: string | null;
	min_value: number | null;
	max_value: number | null;
	target_value: number | null;
}

export interface QcReadingInput {
	qcSpecId: number;
	parameter: string;
	satuan: string | null;
	minValue: number | null;
	maxValue: number | null;
	value: number;
}

/** Spec aktif yang berlaku untuk produk ini: product_id cocok, ATAU product_id kosong (template umum). */
export async function fetchActiveQcSpecs(productId?: number | null): Promise<QcSpecRow[]> {
	try {
		const filter: any = { status: { _eq: 'active' } };
		filter._or = [{ product_id: { _null: true } }, ...(productId ? [{ product_id: { _eq: productId } }] : [])];

		const rows = (await directus.request(
			readItems('qc_spec' as any, {
				filter,
				fields: ['id', 'parameter', 'satuan', 'min_value', 'max_value', 'target_value'],
				sort: ['sort', 'id'],
				limit: -1
			})
		)) as any[];
		return rows || [];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

/** Simpan hasil QC in-process: satu baris qc_results per parameter, Go/No-Go dihitung dari qc_spec. */
export async function submitQcInProcess(params: {
	spkId: number;
	productId?: number | null;
	stage: ProductionStage;
	readings: QcReadingInput[];
	testedBy?: string | null;
	batchNumber?: string | null;
}): Promise<{ success: number; failed: number }> {
	const { spkId, productId, stage, readings, testedBy, batchNumber } = params;
	let success = 0;
	let failed = 0;

	for (const r of readings) {
		const passed =
			r.minValue !== null && r.maxValue !== null
				? r.value >= r.minValue && r.value <= r.maxValue
				: null;
		try {
			await directus.request(
				createItem('qc_results' as any, {
					spk_id: spkId,
					product_id: productId ?? null,
					qc_spec_id: r.qcSpecId,
					parameter: r.parameter,
					satuan: r.satuan,
					value: r.value,
					min_value: r.minValue,
					max_value: r.maxValue,
					passed,
					stage,
					sumber: 'batch_produksi',
					batch_number: batchNumber || null,
					tested_by: testedBy || null,
					tested_at: new Date().toISOString(),
					status: 'recorded'
				} as any)
			);
			success += 1;
		} catch (err) {
			console.error(`[qcInProcessApi] Gagal simpan parameter ${r.parameter}:`, err);
			failed += 1;
		}
	}

	return { success, failed };
}

/** Riwayat QC in-process untuk 1 SPK, terbaru dulu (dipakai tampilan "sudah diisi" di form). */
export async function fetchQcResultsForSpk(spkId: number): Promise<any[]> {
	try {
		return (await directus.request(
			readItems('qc_results' as any, {
				filter: { spk_id: { _eq: spkId } } as any,
				fields: ['id', 'parameter', 'value', 'min_value', 'max_value', 'passed', 'stage', 'tested_at'],
				sort: ['-tested_at'],
				limit: 50
			})
		)) as any[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}
