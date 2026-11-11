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
	/** Grand PO: PO material (so_customer.id) yang memasok cat ini — dasar rekonsiliasi per PO (nullable). */
	soCustomerId?: number;
	qtyUsed?: number;
	satuan?: string;
	dateApplied?: string;
	notes?: string;
	inspectionReportId?: number;
	paintLayerId?: number;
	materialInspectionId?: number;
	createdByName?: string;
}

function buildPayload(params: CreateCoatingLogParams, withSo: boolean) {
	return {
		project_id: params.projectId,
		batch_no: params.batchNo,
		supplier_name: params.supplierName || null,
		product_name: params.productName || null,
		product_id: params.productId ?? null,
		...(withSo ? { so_customer_id: params.soCustomerId ?? null } : {}),
		qty_used: params.qtyUsed ?? null,
		satuan: params.satuan || null,
		date_applied: params.dateApplied || new Date().toISOString().slice(0, 10),
		notes: params.notes || null,
		inspection_report_id: params.inspectionReportId || null,
		paint_layer_id: params.paintLayerId || null,
		material_inspection_id: params.materialInspectionId || null,
		created_by_name: params.createdByName || null
	};
}

const isForbidden = (err: any) => err?.response?.status === 403 || err?.errors?.some?.((e: any) => e?.extensions?.code === 'FORBIDDEN');

export async function createCoatingLog(params: CreateCoatingLogParams) {
	try {
		return await directus.request(createItem(COLLECTION as any, buildPayload(params, true) as any));
	} catch (err) {
		// Kolom so_customer_id baru: bila izin field role belum memuatnya (403), JANGAN menggagalkan pencatatan cat —
		// simpan tanpa tag PO (dihitung per produk) dan catat peringatan jelas agar admin menambah izin field.
		if (params.soCustomerId != null && isForbidden(err)) {
			console.warn('[coating-log] 403 saat menyimpan so_customer_id — izin field role belum memuat kolom ini; disimpan tanpa tag PO.');
			try {
				return await directus.request(createItem(COLLECTION as any, buildPayload(params, false) as any));
			} catch (err2) {
				handleDirectusError(err2);
				throw err2;
			}
		}
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
