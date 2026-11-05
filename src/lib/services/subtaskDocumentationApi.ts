// src/lib/services/subtaskDocumentationApi.ts
// Single Source of Truth untuk koleksi Directus `subtask_documentation`.
// Mendukung pemetaan Before / During / After ke task_index & subtask_index Timeline Gantt Chart.

import directus, { handleDirectusError } from './directus';
import { readItems, createItem, updateItem } from '@directus/sdk';

export interface SubtaskDocumentationRow {
	id?: number;
	project_id: number;
	report_id?: number | null;
	task_index?: number | null;
	subtask_index?: number | null;
	subtask_name: string;
	progress_snapshot?: number | null;
	foto_before?: string | null;
	foto_after?: string | null;
	foto_during?: string | null;
	foto_before_at?: string | null;
	foto_after_at?: string | null;
	foto_during_at?: string | null;
	foto_before_gps?: { lat: number; lng: number } | null;
	foto_after_gps?: { lat: number; lng: number } | null;
	catatan?: string;
	status: 'incomplete' | 'before_only' | 'complete';
	uploaded_by?: number | null;
	date_created?: string;
	sort?: number;
}

export async function getSubtaskDocumentationForProject(projectId: string | number): Promise<SubtaskDocumentationRow[]> {
	try {
		const result = await directus.request(
			readItems('subtask_documentation', {
				filter: { project_id: { _eq: projectId } },
				fields: [
					'id',
					'project_id',
					'report_id',
					'task_index',
					'subtask_index',
					'subtask_name',
					'progress_snapshot',
					'foto_before',
					'foto_after',
					'foto_during',
					'foto_before_at',
					'foto_after_at',
					'foto_during_at',
					'catatan',
					'status',
					'sort',
					'date_created'
				],
				sort: ['id'],
				limit: -1
			})
		);
		return (result as any) || [];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/** Kunjungan baru dimulai (foto before saja). */
export async function createSubtaskDocumentationBefore(row: Omit<SubtaskDocumentationRow, 'id' | 'status'>) {
	try {
		const result = await directus.request(
			createItem('subtask_documentation', {
				...row,
				status: 'before_only',
				foto_before_at: new Date().toISOString()
			})
		);
		return result;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/** Lengkapi kunjungan yang sudah ada dengan foto after -> status jadi 'complete'. */
export async function completeSubtaskDocumentationAfter(
	id: number,
	fotoAfter: string,
	fotoAfterGps?: { lat: number; lng: number } | null
) {
	try {
		const result = await directus.request(
			updateItem('subtask_documentation', id, {
				foto_after: fotoAfter,
				foto_after_at: new Date().toISOString(),
				foto_after_gps: fotoAfterGps || null,
				status: 'complete'
			})
		);
		return result;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/** Upsert dokumentasi subtask: memperbarui jika sudah ada, atau membuat jika belum. */
export async function upsertSubtaskDocumentation(doc: {
	project_id: number;
	report_id?: number | null;
	task_index: number;
	subtask_index: number | null;
	subtask_name: string;
	progress_snapshot?: number | null;
	foto_before?: string | null;
	foto_after?: string | null;
	foto_during?: string | null;
	catatan?: string;
	foto_before_gps?: { lat: number; lng: number } | null;
	foto_after_gps?: { lat: number; lng: number } | null;
}) {
	try {
		const filter: any = {
			project_id: { _eq: doc.project_id },
			task_index: { _eq: doc.task_index }
		};
		if (doc.subtask_index !== null && doc.subtask_index !== undefined) {
			filter.subtask_index = { _eq: doc.subtask_index };
		} else {
			filter.subtask_index = { _null: true };
		}

		const existing = await directus.request(
			readItems('subtask_documentation', {
				filter,
				fields: ['id', 'foto_before', 'foto_after', 'foto_during', 'status', 'catatan'],
				limit: 1
			})
		);

		const nowIso = new Date().toISOString();
		const row = existing && existing[0];

		if (row && row.id) {
			const finalBefore = doc.foto_before || row.foto_before || null;
			const finalAfter = doc.foto_after || row.foto_after || null;
			const finalDuring = doc.foto_during || row.foto_during || null;
			const status = (finalBefore && finalAfter) ? 'complete' : (finalBefore ? 'before_only' : 'incomplete');

			const patchData: any = {
				subtask_name: doc.subtask_name,
				foto_before: finalBefore,
				foto_after: finalAfter,
				foto_during: finalDuring,
				status,
				progress_snapshot: doc.progress_snapshot ?? null,
				catatan: doc.catatan || row.catatan || ''
			};
			if (doc.report_id) patchData.report_id = doc.report_id;
			if (doc.foto_before && !row.foto_before) patchData.foto_before_at = nowIso;
			if (doc.foto_after && !row.foto_after) patchData.foto_after_at = nowIso;
			if (doc.foto_during && !row.foto_during) patchData.foto_during_at = nowIso;
			if (doc.foto_before_gps) patchData.foto_before_gps = doc.foto_before_gps;
			if (doc.foto_after_gps) patchData.foto_after_gps = doc.foto_after_gps;

			return await directus.request(updateItem('subtask_documentation', row.id, patchData));
		} else {
			const status = (doc.foto_before && doc.foto_after) ? 'complete' : (doc.foto_before ? 'before_only' : 'incomplete');
			const createData: any = {
				project_id: doc.project_id,
				report_id: doc.report_id || null,
				task_index: doc.task_index,
				subtask_index: doc.subtask_index ?? null,
				subtask_name: doc.subtask_name,
				progress_snapshot: doc.progress_snapshot ?? null,
				foto_before: doc.foto_before || null,
				foto_after: doc.foto_after || null,
				foto_during: doc.foto_during || null,
				foto_before_at: doc.foto_before ? nowIso : null,
				foto_after_at: doc.foto_after ? nowIso : null,
				foto_during_at: doc.foto_during ? nowIso : null,
				catatan: doc.catatan || '',
				status,
				sort: (doc.task_index ?? 0) * 100 + (doc.subtask_index ?? 0),
				foto_before_gps: doc.foto_before_gps || null,
				foto_after_gps: doc.foto_after_gps || null
			};
			return await directus.request(createItem('subtask_documentation', createData));
		}
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}
