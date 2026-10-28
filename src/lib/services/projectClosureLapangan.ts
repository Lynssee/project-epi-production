// src/lib/services/projectClosureLapangan.ts
// Sisi lapangan dari Evaluasi & Closing Proyek (koleksi dibuat & ditulis utamanya oleh
// admin erp-epi-1 — lihat projectClosureApi.js). Di sini HANYA baca status (read-only)
// + checklist kesiapan closeout milik Leader (reuse project_readiness_checks, prefix
// `closeout_`, sama pola dengan projectSiteSurvey.ts prefix `mob_`). Leader TIDAK bisa
// memulai/menggenerate laporan/evaluasi dari sini — itu tetap wewenang Admin (TabClosure.svelte).

import directus, { handleDirectusError } from './directus';
import { readItems, createItem, updateItem } from '@directus/sdk';
import { getProjectSetting, loadProjectSettings } from './projectSettings';
import { getIdToken } from './secureDirectus';

// Delegasi Peran Fase 5 — jembatan lintas-app ke docGeneratorEngine.js (erp-epi-1),
// karena generator dokumen admin bergantung pada window/FileReader/canvas yang tidak
// tersedia di sini. Endpoint hanya menerima template entity_binding='none' (BAST dkk).
const ADMIN_APP_ORIGIN = '';

export interface GeneratedBast {
	nomorDokumen: string;
	fileId: string;
	outputId: number;
	hash: string;
	pdfBase64: string;
	fileName: string;
}

/**
 * Generate BAST closeout proyek lewat generator dokumen admin (Fase 5, self-service PL).
 * Respons menyertakan PDF (base64) langsung — sengaja menghindari request GET
 * cross-origin kedua ke proxy Directus admin, yang tidak dibuka lintas-domain
 * untuk endpoint lain di luar ini.
 */
export async function generateCloseoutBast(params: {
	projectId: number;
	projectName: string;
	pihakPertama: string;
	pihakKedua: string;
	uraianBarang: string;
	tanggal: string;
}): Promise<GeneratedBast> {
	const token = await getIdToken();
	const res = await fetch(`${ADMIN_APP_ORIGIN}/api/project/bast/generate`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify({
			projectId: params.projectId,
			projectName: params.projectName,
			formInput: {
				pihak_pertama: params.pihakPertama,
				pihak_kedua: params.pihakKedua,
				uraian_barang: params.uraianBarang,
				tanggal: params.tanggal
			}
		})
	});
	const text = await res.text();
	let parsed: any = null;
	try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
	if (!res.ok || !parsed?.success) throw new Error(parsed?.error || `Gagal generate BAST (${res.status})`);
	return parsed.data;
}

/** Picu unduhan file dari base64 (hasil generateCloseoutBast) — tanpa request jaringan lagi. */
export function downloadBastFromBase64(pdfBase64: string, fileName: string): void {
	const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
	const blob = new Blob([bytes], { type: 'application/pdf' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

const CLOSEOUT_PREFIX = 'closeout_';

export interface ClosureStatus {
	id: number;
	stage: string;
	final_report_file: string | null;
	closed_at: string | null;
}

export interface ClosureEvaluation {
	id: number;
	total_skor: number;
	grade: string;
	status: string;
}

export interface ClosureStatusForProject {
	project_id: number;
	stage: string | null;
	closed_at: string | null;
	total_skor: number | null;
	grade: string | null;
}

/** Fase 7 Closing/Evaluasi Terpusat: status closing untuk proyek-proyek yang di-scope user,
 *  batch _in. Read-only murni -- leader tidak bisa memulai/mengubah apapun dari sini (closing
 *  tetap wewenang Admin, lihat catatan header file). Proyek tanpa baris project_closure =
 *  stage null ("Belum Dimulai"). */
export async function getClosureStatusForProjects(projectIds: number[]): Promise<ClosureStatusForProject[]> {
	if (!projectIds || projectIds.length === 0) return [];
	try {
		const [closures, evaluations] = await Promise.all([
			directus.request(
				readItems('project_closure', {
					filter: { project_id: { _in: projectIds } },
					fields: ['id', 'project_id', 'stage', 'closed_at'],
					limit: -1
				})
			) as Promise<any[]>,
			directus.request(
				readItems('project_closure_evaluation', {
					filter: { project_id: { _in: projectIds } },
					fields: ['project_id', 'total_skor', 'grade'],
					sort: ['-date_created'],
					limit: -1
				})
			) as Promise<any[]>
		]);

		const closureByProject = new Map(closures.map((c) => [c.project_id, c]));
		const evalByProject = new Map<number, any>();
		for (const e of evaluations) {
			if (!evalByProject.has(e.project_id)) evalByProject.set(e.project_id, e);
		}

		return projectIds.map((pid) => {
			const closure = closureByProject.get(pid);
			const evaluation = evalByProject.get(pid);
			return {
				project_id: pid,
				stage: closure?.stage || null,
				closed_at: closure?.closed_at || null,
				total_skor: evaluation?.total_skor ?? null,
				grade: evaluation?.grade || null
			};
		});
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getClosureStatus(projectId: number): Promise<ClosureStatus | null> {
	try {
		const rows: any[] = await directus.request(
			readItems('project_closure', { filter: { project_id: { _eq: projectId } }, limit: 1 })
		);
		return rows?.[0] || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function getClosureEvaluation(projectId: number): Promise<ClosureEvaluation | null> {
	try {
		const rows: any[] = await directus.request(
			readItems('project_closure_evaluation', {
				filter: { project_id: { _eq: projectId } },
				sort: ['-date_created'],
				limit: 1
			})
		);
		return rows?.[0] || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/** Checklist kesiapan closeout Leader (setting bersama admin/lapangan) + state tercentang. */
export async function getCloseoutChecklist(projectId: number) {
	await loadProjectSettings();
	const checklist = (getProjectSetting('project.closure.leader_checklist') || []) as Array<{
		id: string;
		label: string;
		wajib: boolean;
	}>;
	const rows: any[] = await directus.request(
		readItems('project_readiness_checks', {
			filter: { project_id: { _eq: projectId }, item_id: { _starts_with: CLOSEOUT_PREFIX } },
			limit: -1
		})
	);
	const byItem = new Map(rows.map((r) => [r.item_id, r]));
	return checklist.map((item) => {
		const row = byItem.get(`${CLOSEOUT_PREFIX}${item.id}`);
		return { ...item, checked: !!row?.checked, checkedBy: row?.checked_by, checkedAt: row?.checked_at };
	});
}

export async function setCloseoutCheck(projectId: number, itemId: string, checked: boolean, actorName: string) {
	const key = `${CLOSEOUT_PREFIX}${itemId}`;
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
