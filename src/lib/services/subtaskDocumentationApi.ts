// src/lib/services/subtaskDocumentationApi.ts
// Fase 6 (Foto Before/After per Subtask, Gate Keras Disiplin Data & Laporan Harian,
// 17 Sep 2026) — CRUD untuk koleksi `subtask_documentation`. Satu subtask boleh punya
// BANYAK baris (per kunjungan/tahap, keputusan user 17 Sep 2026), bukan 1 pasang
// seumur proyek — jadi ini murni create/list, TIDAK ada upsert-by-subtask.

import directus, { handleDirectusError } from './directus';
import { readItems, createItem, updateItem } from '@directus/sdk';

export interface SubtaskDocumentationRow {
	id?: number;
	project_id: number;
	task_index: number;
	subtask_index: number;
	subtask_name: string;
	progress_snapshot?: number | null;
	foto_before?: string | null;
	foto_after?: string | null;
	foto_before_at?: string | null;
	foto_after_at?: string | null;
	foto_before_gps?: { lat: number; lng: number } | null;
	foto_after_gps?: { lat: number; lng: number } | null;
	catatan?: string;
	status: 'incomplete' | 'before_only' | 'complete';
	uploaded_by?: number | null;
	date_created?: string;
}

export async function getSubtaskDocumentationForProject(projectId: string | number): Promise<SubtaskDocumentationRow[]> {
	try {
		const result = await directus.request(
			readItems('subtask_documentation', {
				filter: { project_id: { _eq: projectId } },
				fields: ['id', 'task_index', 'subtask_index', 'subtask_name', 'progress_snapshot', 'foto_before', 'foto_after', 'foto_before_at', 'foto_after_at', 'catatan', 'status', 'date_created'],
				sort: ['-date_created'],
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
			createItem('subtask_documentation', { ...row, status: 'before_only', foto_before_at: new Date().toISOString() })
		);
		return result;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/** Lengkapi kunjungan yang sudah ada dengan foto after -> status jadi 'complete'. */
export async function completeSubtaskDocumentationAfter(id: number, fotoAfter: string, fotoAfterGps?: { lat: number; lng: number } | null) {
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
