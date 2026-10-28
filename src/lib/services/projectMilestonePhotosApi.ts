// src/lib/services/projectMilestonePhotosApi.ts
// Fase 3 (Penajaman Dokumentasi Foto Proyek, 27 Sep 2026) — foto before/during/after per
// termin pembayaran (project_contract_termin ATAU so_payment_termin — dua sistem dipisah
// gate R1 di admin, lihat erp-epi/src/lib/server/gates/terminRoutingGate.js) atau BAST.
// Salinan pola dari erp-epi/src/lib/services/projectMilestonePhotosApi.js.

import { secureDirectusFetch, secureDirectusJson } from './secureDirectus';

const COL = 'project_milestone_photos';

export type MilestonePhotoType = 'before' | 'during' | 'after';
export type MilestoneType = 'termin' | 'bast' | 'progress_persen';

export interface MilestonePhoto {
	id: number;
	project_id?: number;
	milestone_type?: MilestoneType;
	milestone_system?: string | null;
	milestone_ref?: string;
	photo_type: MilestonePhotoType;
	file_id: string;
	caption: string | null;
	uploaded_by: number | null;
	date_taken: string | null;
	date_created: string | null;
}

export interface MilestonePhotoQuery {
	projectId: string | number;
	milestoneType: MilestoneType;
	milestoneRef: string | number;
	milestoneSystem?: string;
}

/** Upload file foto milestone ke Directus /files, kembalikan UUID file. */
export async function uploadMilestonePhotoFile(file: File, title = ''): Promise<string | null> {
	const formData = new FormData();
	if (title) formData.append('title', title);
	formData.append('file', file);
	const res = await secureDirectusFetch('/files', { method: 'POST', body: formData });
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err.errors?.[0]?.message || 'Gagal mengunggah file');
	}
	const data = await res.json();
	return data.data?.id ?? null;
}

export async function fetchMilestonePhotos({ projectId, milestoneType, milestoneRef, milestoneSystem }: MilestonePhotoQuery): Promise<MilestonePhoto[]> {
	const filters = [
		`filter[project_id][_eq]=${encodeURIComponent(String(projectId))}`,
		`filter[milestone_type][_eq]=${encodeURIComponent(milestoneType)}`,
		`filter[milestone_ref][_eq]=${encodeURIComponent(String(milestoneRef))}`
	];
	if (milestoneSystem) filters.push(`filter[milestone_system][_eq]=${encodeURIComponent(milestoneSystem)}`);
	try {
		const res = await secureDirectusJson(
			`/items/${COL}?${filters.join('&')}&fields=id,photo_type,file_id,caption,uploaded_by,date_taken,date_created&sort=date_created&limit=-1`
		);
		return res?.data || [];
	} catch {
		return [];
	}
}

/** Semua foto milestone untuk satu proyek (lintas termin/BAST) — dipakai galeri Fase 5. */
export async function fetchAllMilestonePhotosForProject(projectId: string | number): Promise<MilestonePhoto[]> {
	try {
		const res = await secureDirectusJson(
			`/items/${COL}?filter[project_id][_eq]=${encodeURIComponent(String(projectId))}&fields=id,milestone_type,milestone_system,milestone_ref,photo_type,file_id,caption,date_taken,date_created&sort=-date_created&limit=-1`
		);
		return res?.data || [];
	} catch {
		return [];
	}
}
export async function createMilestonePhoto(params: MilestonePhotoQuery & {
	photoType: MilestonePhotoType;
	fileId: string;
	caption?: string;
	uploadedBy?: number | string | null;
	dateTaken?: string;
}): Promise<MilestonePhoto | null> {
	const payload = {
		project_id: params.projectId,
		milestone_type: params.milestoneType,
		milestone_ref: String(params.milestoneRef),
		milestone_system: params.milestoneSystem || null,
		photo_type: params.photoType,
		file_id: params.fileId,
		caption: params.caption || null,
		uploaded_by: params.uploadedBy || null,
		date_taken: params.dateTaken || new Date().toISOString().split('T')[0]
	};
	const res = await secureDirectusJson(`/items/${COL}`, {
		method: 'POST',
		body: JSON.stringify(payload)
	});
	return res?.data ?? null;
}

export async function deleteMilestonePhoto(id: number): Promise<void> {
	await secureDirectusFetch(`/items/${COL}/${id}`, { method: 'DELETE' });
}
