// src/lib/services/projectPunchListApi.ts
// Quality Management Proyek v2, Fase 2 — Punch List lapangan (foto+GPS+severity).
// Severity 'critical' OTOMATIS membuat draft NCR tertaut (linked_ncr_id) — keputusan user
// 10 Agu 2026 (bukan approval dulu). Verifikasi close boleh QC ATAU PL lapangan (keputusan
// user), area/zone bebas diisi per proyek (tidak ada daftar baku).
//
// Offline-first (R5): pemanggil (halaman punch-list) bertanggung jawab menaruh submission ke
// offlinePunchQueue.ts saat gagal kirim karena sinyal, lalu memanggil createPunch() lagi saat
// flush — createPunch() sendiri hanya tahu cara mengirim ke Directus, bukan soal antrian.

import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem, uploadFiles } from '@directus/sdk';
import { createNcr } from './projectNcrApi';

const COLLECTION = 'project_punch_list';

function pad(n: number, len: number): string {
	return String(n).padStart(len, '0');
}

export function formatPunchNo(date: Date = new Date(), seq = 1): string {
	const yy = pad(date.getFullYear() % 100, 2);
	const mm = pad(date.getMonth() + 1, 2);
	const dd = pad(date.getDate(), 2);
	return `PUNCH-${yy}${mm}${dd}-${pad(seq, 3)}`;
}

async function generatePunchNo(): Promise<string> {
	const now = new Date();
	const prefix = formatPunchNo(now, 1).replace(/-\d{3}$/, '-');
	const existing = await directus.request(
		readItems(COLLECTION as any, { filter: { punch_no: { _starts_with: prefix } } as any, fields: ['id'], limit: -1 })
	);
	return formatPunchNo(now, (existing as any[]).length + 1);
}

/** Upload foto punch ke directus_files, kembalikan file id (null kalau gagal/tidak ada foto). */
export async function uploadPunchPhoto(file: File | Blob, name: string): Promise<string | null> {
	try {
		const formData = new FormData();
		formData.append('file', file, name);
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export interface CreatePunchParams {
	clientTxnId: string;
	projectId: number;
	areaZone?: string;
	severity: string;
	deskripsi: string;
	fotoFileId?: string | null;
	lat?: number | null;
	lng?: number | null;
	createdByName?: string;
}

/**
 * Buat punch baru. Kalau severity='critical', otomatis buat draft NCR (project_ncr, status
 * 'open' seperti biasa) dan tautkan via linked_ncr_id — tanpa approval tambahan (keputusan user).
 */
export async function createPunch(params: CreatePunchParams) {
	const { clientTxnId, projectId, areaZone, severity, deskripsi, fotoFileId, lat, lng, createdByName } = params;
	const punch_no = await generatePunchNo();

	try {
		const saved: any = await directus.request(
			createItem(COLLECTION as any, {
				punch_no,
				client_txn_id: clientTxnId,
				project_id: projectId,
				area_zone: areaZone || null,
				severity,
				deskripsi,
				foto: fotoFileId || null,
				geo_lat: lat ?? null,
				geo_lng: lng ?? null,
				status: 'open',
				created_by_name: createdByName || null
			} as any)
		);

		if (severity === 'critical') {
			try {
				const ncr = await createNcr({
					projectId,
					category: 'workmanship',
					severity: 'critical',
					deskripsi: `[Auto dari Punch List ${punch_no}] ${deskripsi}`,
					lokasiArea: areaZone,
					foto: fotoFileId || undefined,
					actorName: createdByName
				});
				await directus.request(updateItem(COLLECTION as any, saved.id, { linked_ncr_id: (ncr as any).id } as any));
				saved.linked_ncr_id = (ncr as any).id;
			} catch (err) {
				console.warn('[projectPunchListApi] Gagal auto-buat NCR dari punch critical (diabaikan, punch tetap tersimpan):', err);
			}
		}

		return saved;
	} catch (err) {
		handleDirectusError(err);
		throw err;
	}
}

export async function fetchProjectPunchList(projectId: number) {
	try {
		return await directus.request(
			readItems(COLLECTION as any, {
				filter: { project_id: { _eq: projectId } } as any,
				sort: ['-date_created'],
				limit: -1
			})
		);
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function fetchPunchById(id: number) {
	try {
		return await directus.request(readItem(COLLECTION as any, id, { fields: ['*'] }));
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

/** open -> rectified: yang mengerjakan menandai sudah diperbaiki. */
export async function rectifyPunch(id: number, rectifiedById: number | null, note?: string) {
	return directus.request(
		updateItem(COLLECTION as any, id, {
			status: 'rectified',
			rectified_by_id: rectifiedById,
			rectified_at: new Date().toISOString(),
			rectification_note: note || null
		} as any)
	);
}

/** rectified -> closed: verifikasi oleh QC ATAU PL lapangan (keputusan user, bukan QC saja). */
export async function verifyPunch(id: number, verifiedById: number | null) {
	return directus.request(
		updateItem(COLLECTION as any, id, {
			status: 'closed',
			verified_by_id: verifiedById,
			verified_at: new Date().toISOString()
		} as any)
	);
}

export async function voidPunch(id: number, reason: string) {
	if (!reason) throw new Error('Alasan void wajib diisi');
	return directus.request(updateItem(COLLECTION as any, id, { status: 'void', void_reason: reason } as any));
}
