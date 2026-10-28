// Timeline Manual Actual — input manual progres Actual per subtask (sementara,
// sebelum ada alur laporan resmi per-subtask). Koleksi `timeline_actual_manual`.
// Nilai di sini digabung (additive, sama seperti mergeActualFromReports) ke
// daily_actual saat render timeline — TIDAK menimpa data dari laporan harian.

import directus, { handleDirectusError } from './directus';
import { readItems, createItem } from '@directus/sdk';

export interface ManualActualEntry {
	id: number;
	project_id: number;
	category_id: string;
	category_name: string;
	subtask_id: string;
	subtask_name: string;
	tanggal: string;
	progress_value: number;
	input_by_name: string;
	catatan: string | null;
	date_created: string;
}

/** Riwayat input manual actual untuk satu project — dipakai untuk merge ke daily_actual. */
export async function listManualActualByProject(projectId: number): Promise<ManualActualEntry[]> {
	try {
		const result = await directus.request(
			readItems('timeline_actual_manual', {
				filter: { project_id: { _eq: projectId } },
				fields: ['id', 'category_id', 'category_name', 'subtask_id', 'subtask_name', 'tanggal', 'progress_value', 'input_by_name', 'catatan', 'date_created'],
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

/** Simpan satu input manual actual untuk satu subtask pada satu tanggal. */
export async function createManualActual(params: {
	projectId: number;
	categoryId: string;
	categoryName: string;
	subtaskId: string;
	subtaskName: string;
	tanggal: string;
	progressValue: number;
	inputByName: string;
	inputByKaryawanId?: number | null;
	catatan?: string | null;
}) {
	try {
		const result = await directus.request(
			createItem('timeline_actual_manual', {
				project_id: params.projectId,
				category_id: params.categoryId,
				category_name: params.categoryName,
				subtask_id: params.subtaskId,
				subtask_name: params.subtaskName,
				tanggal: params.tanggal,
				progress_value: params.progressValue,
				input_by_name: params.inputByName,
				input_by_karyawan_id: params.inputByKaryawanId ?? null,
				catatan: params.catatan || null
			})
		);
		return { success: true, data: result };
	} catch (error: any) {
		handleDirectusError(error);
		return { success: false, error: error?.message || 'Gagal menyimpan input actual manual' };
	}
}
