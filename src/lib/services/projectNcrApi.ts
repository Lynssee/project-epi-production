// src/lib/services/projectNcrApi.ts
// Quality Management Proyek v2, Fase 1 — NCR (Non-Conformance Report) lapangan.
// Sama kapabilitas dengan versi admin (erp-epi-1/projectNcrApi.js), ditulis terpisah
// karena repo ini TypeScript + @directus/sdk (bukan copy-paste raw fetch).
//
// Alur status: draft -> open -> in_progress -> verification -> closed -> void.
// PL lapangan boleh membuat NCR (langsung 'open', keputusan user 10 Agu 2026) dan
// menandai in_progress/verification; closing (verification -> closed) WAJIB lewat
// Universal Approval Engine — lihat submitCloseApproval().

import directus, { handleDirectusError } from './directus';
import { createItem, readItems, readItem, updateItem } from '@directus/sdk';
import { submitApprovalRequest } from './approvalApi';
import { loadQualitySettings, getQualitySetting } from './qualitySettingsApi';

const COLLECTION = 'project_ncr';
const HISTORY_COLLECTION = 'project_ncr_history';

function pad(n: number, len: number): string {
	return String(n).padStart(len, '0');
}

export function formatNcrNo(date: Date = new Date(), seq = 1): string {
	const yy = pad(date.getFullYear() % 100, 2);
	const mm = pad(date.getMonth() + 1, 2);
	const dd = pad(date.getDate(), 2);
	return `NCR-${yy}${mm}${dd}-${pad(seq, 3)}`;
}

async function generateNcrNo(): Promise<string> {
	const now = new Date();
	const prefix = formatNcrNo(now, 1).replace(/-\d{3}$/, '-');
	const existing = await directus.request(
		readItems(COLLECTION as any, { filter: { ncr_no: { _starts_with: prefix } } as any, fields: ['id'], limit: -1 })
	);
	return formatNcrNo(now, (existing as any[]).length + 1);
}

export async function computeDefaultTenggat(severity: string): Promise<string> {
	await loadQualitySettings();
	const config = getQualitySetting('ncr.severity_config') || {};
	const days = config?.[severity]?.tenggat_hari ?? 7;
	const d = new Date();
	d.setDate(d.getDate() + Number(days));
	return d.toISOString().slice(0, 10);
}

async function logHistory(ncrId: number, fromStatus: string | null, toStatus: string, note?: string, actorName?: string) {
	try {
		await directus.request(
			createItem(HISTORY_COLLECTION as any, {
				ncr_id: ncrId,
				from_status: fromStatus,
				to_status: toStatus,
				note: note || null,
				actor_name: actorName || null
			} as any)
		);
	} catch (err) {
		console.warn('[projectNcrApi] Gagal mencatat history (diabaikan):', err);
	}
}

export interface CreateNcrParams {
	projectId: number;
	category?: string;
	severity: string;
	deskripsi: string;
	lokasiArea?: string;
	foto?: string;
	picId?: number;
	tenggat?: string;
	actorName?: string;
}

/** Buat NCR baru — langsung 'open' (keputusan user). PL lapangan atau QC boleh memanggil ini. */
export async function createNcr(params: CreateNcrParams) {
	const { projectId, category, severity, deskripsi, lokasiArea, foto, picId, tenggat, actorName } = params;
	const ncr_no = await generateNcrNo();
	const finalTenggat = tenggat || (await computeDefaultTenggat(severity));

	try {
		const saved = await directus.request(
			createItem(COLLECTION as any, {
				ncr_no,
				project_id: projectId,
				category: category || null,
				severity,
				deskripsi,
				lokasi_area: lokasiArea || null,
				foto: foto || null,
				pic_id: picId || null,
				tenggat: finalTenggat,
				status: 'open'
			} as any)
		);
		await logHistory((saved as any).id, null, 'open', actorName ? `Dibuat oleh ${actorName}` : 'Dibuat');
		return saved;
	} catch (err) {
		handleDirectusError(err);
		throw err;
	}
}

export async function fetchProjectNcrList(projectId: number) {
	try {
		return await directus.request(
			readItems(COLLECTION as any, {
				filter: { project_id: { _eq: projectId } } as any,
				sort: ['-date_created'],
				limit: -1,
				fields: ['*', 'pic_id.nama_karyawan']
			})
		);
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function fetchNcrById(id: number) {
	try {
		return await directus.request(
			readItem(COLLECTION as any, id, {
				fields: ['*', 'project_id.name', 'pic_id.nama_karyawan', 'created_by_id.nama_karyawan', 'verified_by_id.nama_karyawan']
			})
		);
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export async function fetchNcrHistory(ncrId: number) {
	try {
		return await directus.request(
			readItems(HISTORY_COLLECTION as any, {
				filter: { ncr_id: { _eq: ncrId } } as any,
				sort: ['date_created'],
				limit: -1
			})
		);
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

async function transition(id: number, fromStatus: string, toStatus: string, patch: Record<string, any>, note?: string, actorName?: string) {
	const saved = await directus.request(updateItem(COLLECTION as any, id, { ...patch, status: toStatus } as any));
	await logHistory(id, fromStatus, toStatus, note, actorName);
	return saved;
}

/** open -> in_progress. */
export async function startProgress(id: number, rootCause?: string, actorName?: string) {
	return transition(id, 'open', 'in_progress', { root_cause: rootCause || null }, 'Mulai tindak lanjut', actorName);
}

/** in_progress -> verification. */
export async function requestVerification(id: number, correctiveAction?: string, actorName?: string) {
	return transition(id, 'in_progress', 'verification', { corrective_action: correctiveAction || null }, 'Minta verifikasi', actorName);
}

/** verification -> closed (via Universal Approval Engine, R2) — status tetap 'verification' sampai callback finalisasi. */
export async function submitCloseApproval(id: number, ncrNo: string, projectName?: string) {
	const result: any = await submitApprovalRequest({
		moduleKey: 'project_ncr',
		sourceCollection: COLLECTION,
		sourceId: id,
		title: `Closing NCR ${ncrNo}`,
		summary: `Verifikasi & penutupan NCR proyek ${projectName || ''}`.trim(),
		departmentKey: 'PROJECT',
		callbackUrl: '/api/project-ncr/approval-callback',
		payload: { ncr_id: id }
	});
	const approvalId = result?.data?.id;
	await directus.request(
		updateItem(COLLECTION as any, id, {
			approval_request_id: approvalId ? String(approvalId) : null,
			verified_at: new Date().toISOString()
		} as any)
	);
	await logHistory(id, 'verification', 'verification', 'Diajukan untuk closing lewat Approval Engine');
	return result;
}

export async function voidNcr(id: number, fromStatus: string, reason: string) {
	if (!reason) throw new Error('Alasan void wajib diisi');
	return transition(id, fromStatus, 'void', { void_reason: reason }, reason);
}
