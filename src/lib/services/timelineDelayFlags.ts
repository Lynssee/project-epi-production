// Timeline Delay Flags — alasan keterlambatan aktivitas timeline dari lapangan
// (Timeline & Scope Management, Fase 1). Koleksi `timeline_delay_flags` +
// `delay_reasons` dibuat lewat erp-epi-1; service ini counterpart sisi lapangan.
// Eskalasi WA (n8n) & CRUD delay_reasons/penerima TETAP hanya di erp-epi-1 —
// lapangan hanya boleh: pilih alasan (create flag) & auto-resolve saat progres menyusul.

import directus, { handleDirectusError } from './directus';
import { readItems, createItem, updateItem } from '@directus/sdk';

export interface DelayReason {
	id: number;
	code: string;
	name: string;
	color: string;
}

function newClientTxnId(): string {
	return `delayflag-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Kategori alasan delay aktif, untuk dropdown modal. */
export async function fetchActiveDelayReasons(): Promise<DelayReason[]> {
	try {
		const result = await directus.request(
			readItems('delay_reasons', {
				filter: { is_active: { _eq: true } },
				sort: ['sort_order'],
				fields: ['id', 'code', 'name', 'color'],
				limit: -1
			})
		);
		return (result as any) || [];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/** Flag unresolved untuk satu project — dipakai cek subtask mana yang sudah punya flag aktif. */
export async function fetchUnresolvedFlagsForProject(projectId: number): Promise<any[]> {
	try {
		const result = await directus.request(
			readItems('timeline_delay_flags', {
				filter: { project_id: { _eq: projectId }, resolved: { _eq: false } },
				fields: ['id', 'subtask_id', 'days_delayed', 'delay_reason', 'note'],
				limit: -1
			})
		);
		return (result as any) || [];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/** Buat flag baru — idempoten via client_txn_id, dipanggil saat lapangan submit alasan delay. */
export async function createDelayFlag(params: {
	projectId: number;
	categoryId: string;
	subtaskId: string;
	subtaskName: string;
	daysDelayed: number;
	delayReasonId: number;
	note?: string | null;
}) {
	try {
		const result = await directus.request(
			createItem('timeline_delay_flags', {
				project_id: params.projectId,
				category_id: params.categoryId,
				subtask_id: params.subtaskId,
				subtask_name: params.subtaskName,
				flagged_date: new Date().toISOString().slice(0, 10),
				days_delayed: params.daysDelayed,
				delay_reason: params.delayReasonId,
				note: params.note || null,
				resolved: false,
				client_txn_id: newClientTxnId()
			})
		);
		return { success: true, data: result };
	} catch (error: any) {
		handleDirectusError(error);
		return { success: false, error: error?.message || 'Gagal menyimpan alasan delay' };
	}
}

/** Tandai flag selesai — dipanggil otomatis saat subtask tidak delayed lagi. */
export async function resolveDelayFlag(flagId: number) {
	try {
		await directus.request(
			updateItem('timeline_delay_flags', flagId, {
				resolved: true,
				resolved_date: new Date().toISOString().slice(0, 10)
			})
		);
		return { success: true };
	} catch (error: any) {
		handleDirectusError(error);
		return { success: false, error: error?.message || 'Gagal menutup flag delay' };
	}
}
