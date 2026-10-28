// src/lib/services/omniSendRequest.ts
// "Kirim via Admin" (K-4, Bagian 9): Project Leader tidak boleh chat langsung
// ke pelanggan. Ajukan foto/catatan dari sini, admin ERP yang meninjau &
// mengirim lewat inbox terpadu omnichannel.

import directus, { handleDirectusError } from './directus';
import { readItems, createItem, uploadFiles } from '@directus/sdk';
import { compressPhoto } from '$lib/utils/photoCompress';

export interface SendRequestRow {
	id: number;
	project_id: number;
	requested_by_uid: string | null;
	requested_by_name: string | null;
	note: string | null;
	media_file: string | null;
	media_filename: string | null;
	status: 'pending' | 'sent' | 'rejected' | 'failed';
	reject_reason: string | null;
	reviewed_by_name: string | null;
	reviewed_at: string | null;
	date_created: string;
}

const COLLECTION = 'omni_send_request';
const FIELDS = [
	'id', 'project_id', 'requested_by_uid', 'requested_by_name', 'note',
	'media_file', 'media_filename', 'status', 'reject_reason',
	'reviewed_by_name', 'reviewed_at', 'date_created'
];

export async function uploadSendRequestMedia(file: File): Promise<{ id: string; filename: string } | null> {
	try {
		const compressed = file.type.startsWith('image/') ? await compressPhoto(file) : file;
		const formData = new FormData();
		formData.append('file', compressed, file.name);
		formData.append('description', 'omni_send_request:media');
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id ? { id: result.id, filename: file.name } : null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export interface CreateSendRequestPayload {
	project_id: number;
	requested_by_uid: string | null;
	requested_by_name: string;
	note: string;
	media_file?: string | null;
	media_filename?: string | null;
}

export async function createSendRequest(payload: CreateSendRequestPayload): Promise<SendRequestRow> {
	const created: any = await directus.request(
		createItem(COLLECTION, {
			project_id: payload.project_id,
			requested_by_uid: payload.requested_by_uid,
			requested_by_name: payload.requested_by_name,
			note: payload.note,
			media_file: payload.media_file || null,
			media_filename: payload.media_filename || null,
			status: 'pending'
		})
	);
	return created as SendRequestRow;
}

export async function getSendRequestsByProject(projectId: number): Promise<SendRequestRow[]> {
	try {
		return (await directus.request(
			readItems(COLLECTION, {
				filter: { project_id: { _eq: projectId } },
				fields: FIELDS,
				sort: ['-date_created'],
				limit: 20
			})
		)) as SendRequestRow[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}
