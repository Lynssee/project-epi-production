// src/lib/services/projectSiteSurvey.ts
// Site Survey & Checklist Mobilisasi (Pertajam Perencanaan & Persiapan Proyek v2, Fase 5).
// Ditulis dari sini (lapangan), dibaca admin (erp-epi-1) untuk Gerbang Kesiapan — koleksi
// `project_site_survey` & `project_readiness_checks` (utk checklist mobilisasi, item_id
// diprefix `mob_`) dibuat oleh admin, dibaca/ditulis langsung SDK spt stockLapangan.ts.

import directus, { handleDirectusError } from './directus';
import { readItems, createItem, updateItem } from '@directus/sdk';
import { getProjectSetting, loadProjectSettings } from './projectSettings';

const MOBILIZATION_PREFIX = 'mob_';

export interface SiteSurveyPayload {
	projectId: number;
	aksesJalan: boolean;
	listrik: boolean;
	air: boolean;
	areaKerja: string;
	catatan: string;
	lat?: number | null;
	lng?: number | null;
	accuracy?: number | null;
	evidencePhotoFileId?: string | null;
	submittedBy: string;
	submittedById?: number | null;
}

/** "Ajukan Siap Mobilisasi" — kirim hasil site survey, jadi item auto Gerbang Kesiapan admin. */
export async function submitSiteSurvey(payload: SiteSurveyPayload) {
	try {
		const result: any = await directus.request(
			createItem('project_site_survey', {
				project_id: payload.projectId,
				akses_jalan: payload.aksesJalan,
				listrik: payload.listrik,
				air: payload.air,
				area_kerja: payload.areaKerja || null,
				catatan: payload.catatan || null,
				evidence_gps_lat: payload.lat ?? null,
				evidence_gps_lng: payload.lng ?? null,
				evidence_gps_accuracy: payload.accuracy ?? null,
				evidence_captured_at: payload.lat != null ? new Date().toISOString() : null,
				evidence_photo: payload.evidencePhotoFileId ?? null,
				status: 'submitted',
				submitted_by: payload.submittedBy,
				submitted_by_id: payload.submittedById ?? null,
				submitted_at: new Date().toISOString()
			})
		);
		return result;
	} catch (error) {
		handleDirectusError(error);
		throw error;
	}
}

export async function getLatestSiteSurvey(projectId: number) {
	const rows: any[] = await directus.request(
		readItems('project_site_survey', {
			filter: { project_id: { _eq: projectId } },
			sort: ['-submitted_at'],
			limit: 1
		})
	);
	return rows?.[0] || null;
}

/** Checklist mobilisasi (setting bersama admin/lapangan) + state tercentang untuk satu proyek. */
export async function getMobilizationChecklist(projectId: number) {
	await loadProjectSettings();
	const checklist = (getProjectSetting('project.mobilization.checklist') || []) as Array<{
		id: string;
		label: string;
		wajib: boolean;
	}>;
	const rows: any[] = await directus.request(
		readItems('project_readiness_checks', {
			filter: { project_id: { _eq: projectId }, item_id: { _starts_with: MOBILIZATION_PREFIX } },
			limit: -1
		})
	);
	const byItem = new Map(rows.map((r) => [r.item_id, r]));
	return checklist.map((item) => {
		const row = byItem.get(`${MOBILIZATION_PREFIX}${item.id}`);
		return { ...item, checked: !!row?.checked, checkedBy: row?.checked_by, checkedAt: row?.checked_at };
	});
}

// ─── Kickoff Wizard v2 — Fase 4: checklist persiapan porsi Project Leader ───────────
// Sumber checklist = system_settings `project.readiness.checklist` (sama persis dgn admin,
// sudah ber-`owner`/`langkah`/`bukti` sejak Fase 1). Lapangan HANYA melihat & menulis item
// ber-owner 'leader' | 'both'. item_id disimpan APA ADANYA (mob_apd sudah literal, k3_docs
// bare) — konsisten dgn key yang dibaca admin di projectReadinessApi.js.

export interface LeaderChecklistItem {
	id: string;
	label: string;
	wajib: boolean;
	source: string;
	owner: string;
	langkah: string;
	bukti?: string;
	checked: boolean;
	checkedBy?: string;
	checkedAt?: string;
	evidenceFileId?: string | null;
}

const LEADER_OWNERS = new Set(['leader', 'both']);

/** Checklist persiapan — dibelah jadi porsi Leader (bisa ditulis) & porsi kantor (read-only). */
export async function getPersiapanChecklist(projectId: number): Promise<{
	leaderItems: LeaderChecklistItem[];
	officeItems: LeaderChecklistItem[];
}> {
	await loadProjectSettings();
	const checklist = (getProjectSetting('project.readiness.checklist') || []) as Array<any>;
	const rows: any[] = await directus.request(
		readItems('project_readiness_checks', {
			filter: { project_id: { _eq: projectId } },
			limit: -1
		})
	);
	const byItem = new Map(rows.map((r) => [r.item_id, r]));

	const mapItem = (item: any): LeaderChecklistItem => {
		const row = byItem.get(item.id);
		return {
			id: item.id,
			label: item.label,
			wajib: !!item.wajib,
			source: item.source || 'manual',
			owner: item.owner || 'admin',
			langkah: item.langkah || 'L1',
			bukti: item.bukti,
			checked: !!row?.checked,
			checkedBy: row?.checked_by,
			checkedAt: row?.checked_at,
			evidenceFileId: row?.evidence_file_id ?? null
		};
	};

	const leaderItems: LeaderChecklistItem[] = [];
	const officeItems: LeaderChecklistItem[] = [];
	for (const item of checklist) {
		const mapped = mapItem(item);
		if (LEADER_OWNERS.has(mapped.owner)) leaderItems.push(mapped);
		else officeItems.push(mapped);
	}
	return { leaderItems, officeItems };
}

/**
 * Centang/batalkan satu item checklist persiapan porsi Leader. Guard: hanya item manual
 * ber-owner leader/both yang boleh ditulis dari sini (item auto & porsi admin ditolak).
 * Enforcement sebenarnya ada di permission Directus atas project_readiness_checks +
 * scoping proyek app; ini lapis pertama supaya salah-pakai gagal cepat.
 */
export async function setReadinessCheck(
	projectId: number,
	itemId: string,
	checked: boolean,
	actorName: string,
	evidenceFileId?: string | null
) {
	await loadProjectSettings();
	const checklist = (getProjectSetting('project.readiness.checklist') || []) as Array<any>;
	const def = checklist.find((c) => c.id === itemId);
	if (!def) throw new Error(`Item "${itemId}" tidak dikenal di checklist persiapan.`);
	if (def.source === 'auto') throw new Error(`Item "${def.label}" dihitung otomatis, tidak bisa dicentang manual.`);
	if (!LEADER_OWNERS.has(def.owner || 'admin')) {
		throw new Error(`Item "${def.label}" adalah porsi kantor — hanya admin/HSE yang mencentang.`);
	}

	const existing: any[] = await directus.request(
		readItems('project_readiness_checks', {
			filter: { project_id: { _eq: projectId }, item_id: { _eq: itemId } },
			limit: 1
		})
	);
	const payload: Record<string, any> = {
		project_id: projectId,
		item_id: itemId,
		checked,
		checked_by: actorName,
		checked_at: new Date().toISOString(),
		owner_role: def.owner || 'leader'
	};
	if (evidenceFileId !== undefined) payload.evidence_file_id = evidenceFileId;

	if (existing?.[0]) {
		await directus.request(updateItem('project_readiness_checks', existing[0].id, payload));
	} else {
		await directus.request(createItem('project_readiness_checks', payload));
	}
}

/** Centang/batalkan satu item checklist mobilisasi — reuse koleksi project_readiness_checks yang sama dgn admin. */
export async function setMobilizationCheck(
	projectId: number,
	itemId: string,
	checked: boolean,
	actorName: string
) {
	const key = `${MOBILIZATION_PREFIX}${itemId}`;
	const existing: any[] = await directus.request(
		readItems('project_readiness_checks', {
			filter: { project_id: { _eq: projectId }, item_id: { _eq: key } },
			limit: 1
		})
	);
	const payload = {
		project_id: projectId,
		item_id: key,
		checked,
		checked_by: actorName,
		checked_at: new Date().toISOString()
	};
	if (existing?.[0]) {
		await directus.request(updateItem('project_readiness_checks', existing[0].id, payload));
	} else {
		await directus.request(createItem('project_readiness_checks', payload));
	}
}
