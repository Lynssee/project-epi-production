// src/lib/services/projectItpApi.ts
// Quality Management Proyek v2, Fase 3 — runner ITP lapangan (centang+foto per item).
// Hold point = WARNING + wajib justifikasi saat dicentang, TIDAK memblokir item lain atau
// eksekusi ITP secara keseluruhan (keputusan user 10 Agu 2026) — beda dari hold_point_flag
// di inspection_report yang juga cuma warning+justifikasi, bukan hard block, jadi konsisten.

import directus, { handleDirectusError } from './directus';
import { readItems, readItem, updateItem, uploadFiles } from '@directus/sdk';

const PROJECT_ITP_COLLECTION = 'project_itp';
const EXECUTION_COLLECTION = 'project_itp_execution';

export async function fetchProjectItpList(projectId: number) {
	try {
		return await directus.request(
			readItems(PROJECT_ITP_COLLECTION as any, {
				filter: { project_id: { _eq: projectId } } as any,
				sort: ['-date_created'],
				limit: -1,
				fields: ['*', 'template_id.name']
			})
		);
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function fetchItpDetail(projectItpId: number) {
	try {
		const itp: any = await directus.request(
			readItem(PROJECT_ITP_COLLECTION as any, projectItpId, { fields: ['*', 'project_id.name', 'template_id.name'] })
		);
		const executions = await directus.request(
			readItems(EXECUTION_COLLECTION as any, {
				filter: { project_itp_id: { _eq: projectItpId } } as any,
				sort: ['template_item_id.sort'],
				limit: -1,
				fields: ['*', 'template_item_id.label', 'template_item_id.require_photo', 'template_item_id.is_hold_point', 'template_item_id.sort']
			})
		);
		return { itp, executions: (executions as any[]).sort((a, b) => (a.template_item_id?.sort ?? 0) - (b.template_item_id?.sort ?? 0)) };
	} catch (err) {
		handleDirectusError(err);
		return { itp: null, executions: [] };
	}
}

/** Upload foto item ITP ke directus_files, kembalikan file id. */
export async function uploadItpPhoto(file: File): Promise<string | null> {
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

export interface CheckItemParams {
	executionId: number;
	checkedById: number | null;
	photoFileId?: string | null;
	note?: string;
	holdPointJustification?: string;
}

/**
 * Centang satu item eksekusi ITP. Kalau item ini is_hold_point, pemanggil (UI) WAJIB
 * memaksa isi holdPointJustification sebelum memanggil ini — fungsi ini sendiri tidak
 * menolak request kalau kosong (warning, bukan hard block, sesuai keputusan user).
 */
export async function checkItem(params: CheckItemParams) {
	const { executionId, checkedById, photoFileId, note, holdPointJustification } = params;
	return directus.request(
		updateItem(EXECUTION_COLLECTION as any, executionId, {
			checked: true,
			checked_by_id: checkedById,
			checked_at: new Date().toISOString(),
			photo: photoFileId || null,
			note: note || null,
			hold_point_justification: holdPointJustification || null
		} as any)
	);
}

export async function uncheckItem(executionId: number) {
	return directus.request(
		updateItem(EXECUTION_COLLECTION as any, executionId, { checked: false, checked_by_id: null, checked_at: null } as any)
	);
}

/** Update status project_itp (assigned/in_progress/completed) — dipanggil setelah checkItem. */
export async function updateItpStatus(projectItpId: number, status: string) {
	return directus.request(updateItem(PROJECT_ITP_COLLECTION as any, projectItpId, { status } as any));
}
