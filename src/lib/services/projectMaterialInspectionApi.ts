// src/lib/services/projectMaterialInspectionApi.ts
// Quality Management Proyek v2, Fase 3 — QC material/barang masuk lapangan. condition='reject'
// otomatis bikin draft NCR tertaut (linked_ncr_id) — pola sama persis dengan Punch List
// critical (Fase 2). BELUM disambung ke stock-lapangan/inventory-proyek (keputusan user
// 10 Agu 2026) — berdiri sendiri dulu sampai modul ini terbukti dipakai.

import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem, uploadFiles } from '@directus/sdk';
import { createNcr } from './projectNcrApi';

const COLLECTION = 'project_material_inspection';

export async function uploadMaterialPhoto(file: File): Promise<string | null> {
	try {
		const formData = new FormData();
		formData.append('file', file);
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export interface CreateMaterialInspectionParams {
	projectId: number;
	materialName: string;
	poNo?: string;
	qty?: number;
	satuan?: string;
	condition: 'baik' | 'reject' | 'partial';
	rejectReason?: string;
	photoFileId?: string | null;
	inspectedById?: number | null;
	actorName?: string;
	ownershipType?: 'eltama' | 'subcon' | 'customer' | 'sewa_vendor';
	ownerName?: string | null;
}

export async function createMaterialInspection(params: CreateMaterialInspectionParams) {
	const {
		projectId,
		materialName,
		poNo,
		qty,
		satuan,
		condition,
		rejectReason,
		photoFileId,
		inspectedById,
		actorName,
		ownershipType = 'eltama',
		ownerName = null
	} = params;
	try {
		const saved: any = await directus.request(
			createItem(COLLECTION as any, {
				project_id: projectId,
				material_name: materialName,
				po_no: poNo || null,
				qty: qty ?? null,
				satuan: satuan || null,
				condition,
				reject_reason: condition === 'reject' ? rejectReason || null : null,
				photo: photoFileId || null,
				inspected_by_id: inspectedById || null,
				ownership_type: ownershipType,
				owner_name: ownerName
			} as any)
		);

		if (condition === 'reject') {
			try {
				const ncr = await createNcr({
					projectId,
					category: 'material',
					severity: 'major',
					deskripsi: `[Auto dari Material Inspection] ${materialName}${poNo ? ` (PO ${poNo})` : ''} — ${rejectReason || 'reject QC'}`,
					foto: photoFileId || undefined,
					actorName
				});
				await directus.request(updateItem(COLLECTION as any, saved.id, { linked_ncr_id: (ncr as any).id } as any));
				saved.linked_ncr_id = (ncr as any).id;
			} catch (err) {
				console.warn('[projectMaterialInspectionApi] Gagal auto-buat NCR dari reject (diabaikan, inspeksi tetap tersimpan):', err);
			}
		}

		return saved;
	} catch (err) {
		handleDirectusError(err);
		throw err;
	}
}

export async function fetchProjectMaterialInspections(projectId: number) {
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
