// src/lib/services/projectCoatingLogApi.ts
// Quality Management Proyek v2, Fase 5 (opsional) — Coating/Application Log lapangan.
// Untuk semua proyek yang punya inspeksi coating (tidak dibatasi jenis proyek tertentu,
// keputusan user 10 Agu 2026). batch_no WAJIB — traceability sampai nomor batch SUPPLIER
// (beda dari batch_part_a/b/thinner di inspection_paint_layer yang merupakan batch campur
// inspector). DFT/ambient TIDAK diduplikasi di sini — sudah ada di inspection_report/
// inspection_paint_layer, tautkan via inspection_report_id/paint_layer_id kalau relevan.

import directus, { handleDirectusError } from './directus';
import { readItems, createItem } from '@directus/sdk';

const COLLECTION = 'project_coating_log';

export interface CreateCoatingLogParams {
	projectId: number;
	batchNo: string;
	supplierName?: string;
	productName?: string;
	/** Grand PO Fase 6: id produk dari PO material yang memasok (nullable; teks lama tetap valid). */
	productId?: number;
	qtyUsed?: number;
	satuan?: string;
	dateApplied?: string;
	notes?: string;
	inspectionReportId?: number;
	paintLayerId?: number;
	materialInspectionId?: number;
	createdByName?: string;
}

export async function createCoatingLog(params: CreateCoatingLogParams) {
	try {
		return await directus.request(
			createItem(COLLECTION as any, {
				project_id: params.projectId,
				batch_no: params.batchNo,
				supplier_name: params.supplierName || null,
				product_name: params.productName || null,
				product_id: params.productId ?? null,
				qty_used: params.qtyUsed ?? null,
				satuan: params.satuan || null,
				date_applied: params.dateApplied || new Date().toISOString().slice(0, 10),
				notes: params.notes || null,
				inspection_report_id: params.inspectionReportId || null,
				paint_layer_id: params.paintLayerId || null,
				material_inspection_id: params.materialInspectionId || null,
				created_by_name: params.createdByName || null
			} as any)
		);
	} catch (err) {
		handleDirectusError(err);
		throw err;
	}
}

export async function fetchProjectCoatingLogs(projectId: number) {
	try {
		return await directus.request(
			readItems(COLLECTION as any, {
				filter: { project_id: { _eq: projectId } } as any,
				sort: ['-date_created'],
				limit: -1
			})
		);
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}
