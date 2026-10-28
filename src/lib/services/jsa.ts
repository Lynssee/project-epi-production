// src/lib/services/jsa.ts
// JSA (Job Safety Analysis) per proyek/aktivitas — Fase 3 rencana JSA &
// Administrasi HSE v2.0, sisi lapangan. Cermin dari jsaApi.js di admin
// (erp-epi-1) — TIDAK disalin sebagai service yang sama karena dua repo
// memakai pola auth berbeda (T7): admin lewat secureDirectusFetch, lapangan
// lewat SDK Directus yang menembak proxy Firebase-auth sendiri.
//
// Modul TERPISAH dari HIRADC (K1). Satu JSA per aktivitas/jenis pekerjaan
// dalam proyek (K2). Approval satu tingkat (K3): PL mengajukan di sini,
// HSE Manager/PM/admin menyetujui di dashboard admin.

import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem, uploadFiles } from '@directus/sdk';

export interface JsaTemplate {
	id: number;
	work_type: string;
	nama: string;
	versi: number;
	status: string;
	langkah_default: JsaStepData[];
}

export interface JsaStepData {
	langkah?: string;
	bahaya?: string;
	likelihood?: number | null;
	severity?: number | null;
	pengendalian?: string;
	apd?: string[];
	risiko_sisa_likelihood?: number | null;
	risiko_sisa_severity?: number | null;
}

export interface JsaStep extends JsaStepData {
	id: number;
	jsa_project_id: number;
	urutan: number;
	langkah_kerja: string;
}

export interface JsaProject {
	id: number;
	project_id: number;
	template_id: number | { id: number; nama: string; work_type: string };
	aktivitas: string;
	versi_template_snapshot: number | null;
	berlaku_dari: string | null;
	berlaku_sampai: string | null;
	status: string;
	dibuat_oleh: string | null;
	diajukan_at: string | null;
	disetujui_oleh: string | null;
	disetujui_at: string | null;
	catatan_approval: string | null;
	ttd_pembuat: string | null;
	foto: string | null;
	date_created: string;
}

/** Template aktif untuk jenis pekerjaan tertentu — hanya yang sudah direview HSE (status aktif). */
export async function listActiveTemplates(workType?: string): Promise<JsaTemplate[]> {
	try {
		const filter: Record<string, any> = { status: { _eq: 'aktif' } };
		if (workType) filter.work_type = { _eq: workType };
		return (await directus.request(
			readItems('jsa_template', {
				filter,
				fields: ['id', 'work_type', 'nama', 'versi', 'status', 'langkah_default'],
				sort: ['work_type'],
				limit: -1
			})
		)) as unknown as JsaTemplate[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function listJsaByProject(projectId: number | string): Promise<JsaProject[]> {
	try {
		return (await directus.request(
			readItems('jsa_project', {
				filter: { project_id: { _eq: projectId as any } },
				fields: [
					'id', 'project_id', 'template_id.id', 'template_id.nama', 'template_id.work_type',
					'aktivitas', 'versi_template_snapshot', 'berlaku_dari', 'berlaku_sampai', 'status',
					'dibuat_oleh', 'diajukan_at', 'disetujui_oleh', 'disetujui_at', 'catatan_approval',
					'ttd_pembuat', 'foto', 'date_created'
				],
				sort: ['-date_created'],
				limit: -1
			})
		)) as unknown as JsaProject[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getJsaProject(id: number): Promise<JsaProject | null> {
	try {
		return (await directus.request(readItem('jsa_project', id, {
			fields: [
				'id', 'project_id', 'template_id.id', 'template_id.nama', 'template_id.work_type',
				'aktivitas', 'versi_template_snapshot', 'berlaku_dari', 'berlaku_sampai', 'status',
				'dibuat_oleh', 'diajukan_at', 'disetujui_oleh', 'disetujui_at', 'catatan_approval',
				'ttd_pembuat', 'foto', 'date_created'
			]
		}))) as unknown as JsaProject;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function listJsaSteps(jsaProjectId: number): Promise<JsaStep[]> {
	try {
		return (await directus.request(
			readItems('jsa_step', {
				filter: { jsa_project_id: { _eq: jsaProjectId } },
				sort: ['urutan'],
				limit: -1
			})
		)) as unknown as JsaStep[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/** Buat JSA baru dari template — langkah_default disalin jadi jsa_step, PL menyunting salinannya. */
export async function createJsaFromTemplate(p: {
	projectId: number | string;
	templateId: number;
	aktivitas: string;
	berlakuDari: string;
	berlakuSampai: string;
	dibuatOleh: string;
}): Promise<JsaProject> {
	const template: any = await directus.request(
		readItem('jsa_template', p.templateId, { fields: ['id', 'versi', 'langkah_default'] })
	);

	const created: any = await directus.request(
		createItem('jsa_project', {
			project_id: p.projectId,
			template_id: p.templateId,
			aktivitas: p.aktivitas,
			versi_template_snapshot: template?.versi ?? null,
			berlaku_dari: p.berlakuDari,
			berlaku_sampai: p.berlakuSampai,
			status: 'draft',
			dibuat_oleh: p.dibuatOleh
		})
	);

	const langkahDefault: JsaStepData[] = Array.isArray(template?.langkah_default) ? template.langkah_default : [];
	for (const [i, langkah] of langkahDefault.entries()) {
		await directus.request(
			createItem('jsa_step', {
				jsa_project_id: created.id,
				urutan: i + 1,
				langkah_kerja: langkah.langkah || '',
				bahaya: langkah.bahaya || '',
				likelihood: langkah.likelihood ?? null,
				severity: langkah.severity ?? null,
				pengendalian: langkah.pengendalian || '',
				risiko_sisa_likelihood: langkah.risiko_sisa_likelihood ?? null,
				risiko_sisa_severity: langkah.risiko_sisa_severity ?? null,
				apd: langkah.apd || []
			})
		);
	}

	return created;
}

export async function updateJsaStep(id: number, payload: Partial<JsaStep>) {
	return directus.request(updateItem('jsa_step', id, payload));
}

function dataUrlToFile(dataUrl: string, filename: string): File {
	const arr = dataUrl.split(',');
	const mimeMatch = arr[0].match(/:(.*?);/);
	const mime = mimeMatch ? mimeMatch[1] : 'image/png';
	const bstr = atob(arr[1]);
	let n = bstr.length;
	const u8arr = new Uint8Array(n);
	while (n--) u8arr[n] = bstr.charCodeAt(n);
	return new File([u8arr], filename, { type: mime });
}

export async function uploadJsaSignature(dataUrl: string, jsaProjectId: number): Promise<string> {
	const file = dataUrlToFile(dataUrl, `ttd-jsa-${jsaProjectId}-${Date.now()}.png`);
	const formData = new FormData();
	formData.append('title', `TTD JSA #${jsaProjectId}`);
	formData.append('file', file);
	const uploaded: any = await directus.request(uploadFiles(formData as any));
	return uploaded.id;
}

export async function uploadJsaFoto(file: File): Promise<string> {
	const formData = new FormData();
	formData.append('file', file);
	const uploaded: any = await directus.request(uploadFiles(formData as any));
	return uploaded.id;
}

/** PL mengajukan JSA untuk approval (K3 — approval satu tingkat oleh HSE Manager/PM/admin di dashboard admin). */
export async function ajukanJsa(id: number, p: { ttdDataUrl: string; fotoFileId?: string | null }) {
	const ttdFileId = await uploadJsaSignature(p.ttdDataUrl, id);
	return directus.request(
		updateItem('jsa_project', id, {
			status: 'diajukan',
			diajukan_at: new Date().toISOString(),
			ttd_pembuat: ttdFileId,
			ttd_pembuat_at: new Date().toISOString(),
			foto: p.fotoFileId || null
		})
	);
}
