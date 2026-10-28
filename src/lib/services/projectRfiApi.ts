// src/lib/services/projectRfiApi.ts
// Quality Management Proyek v2, Fase 2 — RFI (Request for Inspection) lapangan.
// Lead time default (rfi.lead_time_days = 2 hari kerja) dipakai reminder n8n
// (api/automation/rfi-reminder di admin), bukan divalidasi di sini.

import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem } from '@directus/sdk';

const COLLECTION = 'project_rfi';

function pad(n: number, len: number): string {
	return String(n).padStart(len, '0');
}

export function formatRfiNo(date: Date = new Date(), seq = 1): string {
	const yy = pad(date.getFullYear() % 100, 2);
	const mm = pad(date.getMonth() + 1, 2);
	const dd = pad(date.getDate(), 2);
	return `RFI-${yy}${mm}${dd}-${pad(seq, 3)}`;
}

async function generateRfiNo(): Promise<string> {
	const now = new Date();
	const prefix = formatRfiNo(now, 1).replace(/-\d{3}$/, '-');
	const existing = await directus.request(
		readItems(COLLECTION as any, { filter: { rfi_no: { _starts_with: prefix } } as any, fields: ['id'], limit: -1 })
	);
	return formatRfiNo(now, (existing as any[]).length + 1);
}

export interface CreateRfiParams {
	projectId: number;
	areaZone?: string;
	deskripsi: string;
	requestedById?: number;
}

export async function createRfi(params: CreateRfiParams) {
	const { projectId, areaZone, deskripsi, requestedById } = params;
	const rfi_no = await generateRfiNo();
	try {
		return await directus.request(
			createItem(COLLECTION as any, {
				rfi_no,
				project_id: projectId,
				area_zone: areaZone || null,
				deskripsi,
				requested_by_id: requestedById || null,
				status: 'open'
			} as any)
		);
	} catch (err) {
		handleDirectusError(err);
		throw err;
	}
}

export async function fetchProjectRfiList(projectId: number) {
	try {
		return await directus.request(
			readItems(COLLECTION as any, {
				filter: { project_id: { _eq: projectId } } as any,
				sort: ['-requested_at'],
				limit: -1,
				fields: ['*', 'inspector_id.nama_karyawan']
			})
		);
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function fetchRfiById(id: number) {
	try {
		return await directus.request(readItem(COLLECTION as any, id, { fields: ['*', 'inspector_id.nama_karyawan'] }));
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export async function completeRfi(id: number) {
	return directus.request(updateItem(COLLECTION as any, id, { status: 'completed', completed_at: new Date().toISOString() } as any));
}

export async function cancelRfi(id: number, reason: string) {
	if (!reason) throw new Error('Alasan pembatalan wajib diisi');
	return directus.request(updateItem(COLLECTION as any, id, { status: 'cancelled', cancel_reason: reason } as any));
}
