// src/lib/services/mobilizationChecklist.ts
// Pertajam Fase Planning — Fase 2 (sisi lapangan). Checklist Pra-Mobilisasi: PL/Manpower
// Leader mencentang item setiap hari sebelum tim berangkat ke site. Master item
// (mobilization_checklist_item) diatur admin di erp-epi; submission harian disimpan di
// project_mobilization_checklist. Cermin pola jsa.ts (T7: SDK Directus lapangan, bukan
// secureDirectusFetch admin).

import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem } from '@directus/sdk';

export interface MobilizationChecklistItem {
	id: number;
	kategori: string;
	label: string;
	jenis_proyek_berlaku: string[] | null;
	is_required: boolean;
	urutan: number;
	is_active: boolean;
	hint: string | null;
}

export interface MobilizationSubmission {
	id: number;
	project_id: number;
	tanggal: string;
	submitted_by_karyawan_id: number | null;
	submitted_by_name: string | null;
	items_snapshot: Array<{ item_id: number; label: string; kategori: string; checked: boolean }>;
	total_items: number;
	checked_items: number;
	is_complete: boolean;
	catatan: string | null;
	date_created: string;
}

/** Item aktif yang berlaku untuk jenis proyek ini ('site'/'workshop') — 'semua' selalu ikut. */
export async function listActiveChecklistItems(jenisProyek: 'site' | 'workshop'): Promise<MobilizationChecklistItem[]> {
	try {
		const items = (await directus.request(
			readItems('mobilization_checklist_item', {
				filter: { is_active: { _eq: true } },
				fields: ['id', 'kategori', 'label', 'jenis_proyek_berlaku', 'is_required', 'urutan', 'is_active', 'hint'],
				sort: ['urutan'],
				limit: -1
			})
		)) as unknown as MobilizationChecklistItem[];
		return items.filter((it) => {
			const berlaku = Array.isArray(it.jenis_proyek_berlaku) ? it.jenis_proyek_berlaku : [];
			return berlaku.length === 0 || berlaku.includes('semua') || berlaku.includes(jenisProyek);
		});
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export interface MobilizationProjectContext {
	id: number;
	name: string;
	leader_id: number | null;
	manpower_leader_id: number | null;
	manpower_leader_wakil_id: number | null;
	workshop: string | null;
}

/** Konteks minimal proyek untuk halaman checklist — field dipisah dari getProjectById
 *  (projects.ts) karena butuh manpower_leader_id/_wakil_id yg tidak di-fetch di sana. */
export async function getProjectMobilizationContext(projectId: number | string): Promise<MobilizationProjectContext | null> {
	try {
		return (await directus.request(
			readItem('projects', projectId, {
				fields: ['id', 'name', 'leader_id', 'manpower_leader_id', 'manpower_leader_wakil_id', 'workshop']
			})
		)) as unknown as MobilizationProjectContext;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/** PL (leader_id), Manpower Leader, atau wakilnya — satu-satunya yang boleh mengisi checklist. */
export function canFillChecklist(ctx: MobilizationProjectContext | null, karyawanId: number | null): boolean {
	if (!ctx || !karyawanId) return false;
	return [ctx.leader_id, ctx.manpower_leader_id, ctx.manpower_leader_wakil_id]
		.filter((v) => v != null)
		.some((v) => String(v) === String(karyawanId));
}

function todayStr(): string {
	return new Date().toISOString().slice(0, 10);
}

/** Submission hari ini untuk proyek ini — null bila belum pernah diisi. */
export async function getTodaySubmission(projectId: number | string): Promise<MobilizationSubmission | null> {
	try {
		const rows = (await directus.request(
			readItems('project_mobilization_checklist', {
				filter: { project_id: { _eq: projectId as any }, tanggal: { _eq: todayStr() } },
				fields: [
					'id', 'project_id', 'tanggal', 'submitted_by_karyawan_id', 'submitted_by_name',
					'items_snapshot', 'total_items', 'checked_items', 'is_complete', 'catatan', 'date_created'
				],
				limit: 1
			})
		)) as unknown as MobilizationSubmission[];
		return rows[0] || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/** Riwayat submission N hari terakhir untuk proyek ini. */
export async function listSubmissionHistory(projectId: number | string, limit = 7): Promise<MobilizationSubmission[]> {
	try {
		return (await directus.request(
			readItems('project_mobilization_checklist', {
				filter: { project_id: { _eq: projectId as any } },
				fields: [
					'id', 'project_id', 'tanggal', 'submitted_by_karyawan_id', 'submitted_by_name',
					'items_snapshot', 'total_items', 'checked_items', 'is_complete', 'catatan', 'date_created'
				],
				sort: ['-tanggal'],
				limit
			})
		)) as unknown as MobilizationSubmission[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/** Simpan/perbarui checklist hari ini (upsert — satu submission per project per tanggal).
 *  `allRequiredChecked` dihitung di caller (sudah tahu is_required per item — items_snapshot
 *  sengaja tidak menyimpan is_required, itu atribut master yang bisa berubah). */
export async function saveTodaySubmission(p: {
	projectId: number | string;
	karyawanId: number | null;
	karyawanName: string | null;
	items: Array<{ item_id: number; label: string; kategori: string; checked: boolean }>;
	allRequiredChecked: boolean;
	catatan?: string;
}): Promise<MobilizationSubmission> {
	const checkedItems = p.items.filter((i) => i.checked).length;
	const payload = {
		project_id: p.projectId,
		tanggal: todayStr(),
		submitted_by_karyawan_id: p.karyawanId,
		submitted_by_name: p.karyawanName,
		items_snapshot: p.items,
		total_items: p.items.length,
		checked_items: checkedItems,
		is_complete: p.allRequiredChecked,
		catatan: p.catatan || null
	};

	const existing = await getTodaySubmission(p.projectId);
	if (existing) {
		return (await directus.request(updateItem('project_mobilization_checklist', existing.id, payload))) as unknown as MobilizationSubmission;
	}
	return (await directus.request(createItem('project_mobilization_checklist', payload))) as unknown as MobilizationSubmission;
}
