// src/lib/services/projectActionApi.ts
// Service API Modul "Instruksi & Kendala Proyek" di Dashboard Lapangan (project-epi).
// Offline-friendly, optimasi kompresi foto kamera lapangan (max 0.8MB), dan Directus separated relation fetch.

import directus, { handleDirectusError } from './directus';
import { readItems, createItem, updateItem, uploadFiles } from '@directus/sdk';
import imageCompression from 'browser-image-compression';

export interface ProjectActionItem {
	id: number;
	project_id: number;
	nomor_dokumen: string;
	kategori: 'instruksi_manajemen' | 'kendala_lapangan' | 'komplain_klien';
	tingkat_urgensi: 'normal' | 'tinggi' | 'kritis_darurat';
	dampak: 'tidak_signifikan' | 'risiko_delay' | 'risiko_kualitas' | 'risiko_hse' | 'pekerjaan_terhenti';
	judul: string;
	deskripsi: string;
	target_selesai: string | null;
	pic_pelaksana_id: string | null;
	pic_pelaksana_nama: string | null;
	pembuat_id: string | null;
	pembuat_nama: string | null;
	status: 'open' | 'acknowledged' | 'in_progress' | 'pending_verification' | 'closed' | 'cancelled';
	is_gate_blocker: boolean;
	scope_lock?: 'seluruh_proyek' | 'unit_spesifik';
	target_unit_id?: number | null;
	lampiran_masalah: string[] | null;
	bukti_penyelesaian: string[] | null;
	catatan_penyelesaian: string | null;
	verified_by: string | null;
	verified_at: string | null;
	date_created: string;
	date_updated: string;
}

export interface ProjectActionLog {
	id: number;
	action_item_id: number;
	user_id: string;
	user_nama: string;
	action_type: string;
	status_sebelum: string | null;
	status_sesudah: string | null;
	catatan: string | null;
	date_created: string;
}

const COLLECTION_ITEMS = 'project_action_items';
const COLLECTION_LOGS = 'project_action_logs';

const ITEM_FIELDS = [
	'id', 'project_id', 'nomor_dokumen', 'kategori', 'tingkat_urgensi',
	'dampak', 'judul', 'deskripsi', 'target_selesai',
	'pic_pelaksana_id', 'pic_pelaksana_nama', 'pembuat_id', 'pembuat_nama',
	'status', 'is_gate_blocker', 'scope_lock', 'target_unit_id', 'lampiran_masalah', 'bukti_penyelesaian',
	'catatan_penyelesaian', 'verified_by', 'verified_at', 'date_created', 'date_updated'
];

/**
 * Kompresi foto bukti dari kamera lapangan sebelum diunggah ke Directus.
 * Mencegah server overload dan hemat kuota internet tim site.
 */
export async function compressFieldPhoto(file: File): Promise<File> {
	const options = {
		maxSizeMB: 0.8,
		maxWidthOrHeight: 1280,
		useWebWorker: true,
		fileType: 'image/jpeg'
	};
	try {
		return await imageCompression(file, options);
	} catch (e) {
		console.warn('[projectActionApi] Kompresi gagal, pakai file asli:', e);
		return file;
	}
}

/**
 * Upload single file ke Directus /files.
 */
export async function uploadActionPhoto(file: File | Blob, filename: string): Promise<string | null> {
	try {
		const formData = new FormData();
		formData.append('file', file, filename);
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

/**
 * Mengambil instruksi aktif manajemen yang perlu perhatian PIC lapangan.
 * Ditampilkan di Sticky Action Banner atas dashboard proyek site.
 */
export async function fetchActiveDirectivesForProject(projectId: number): Promise<ProjectActionItem[]> {
	if (!projectId) return [];
	try {
		const result = await directus.request(
			readItems(COLLECTION_ITEMS as any, {
				filter: {
					_or: [
						{ project_id: { _eq: projectId } },
						{ project_id: { _null: true } }
					],
					status: { _nin: ['closed', 'cancelled'] }
				} as any,
				fields: ITEM_FIELDS as any,
				sort: ['-tingkat_urgensi', '-date_created'] as any,
				limit: 10
			})
		);
		return (result || []) as ProjectActionItem[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

/**
 * Mengambil instruksi aktif manajemen untuk beberapa proyek sekaligus (misal proyek milik satu leader)
 * ditambah instruksi global dari Direksi.
 */
export async function fetchActiveDirectivesForProjects(projectIds: number[]): Promise<ProjectActionItem[]> {
	try {
		const orConditions: any[] = [{ project_id: { _null: true } }];
		if (projectIds && projectIds.length > 0) {
			orConditions.push({ project_id: { _in: projectIds } });
		}
		const result = await directus.request(
			readItems(COLLECTION_ITEMS as any, {
				filter: {
					_or: orConditions,
					status: { _nin: ['closed', 'cancelled'] }
				} as any,
				fields: ITEM_FIELDS as any,
				sort: ['-tingkat_urgensi', '-date_created'] as any,
				limit: 20
			})
		);
		return (result || []) as ProjectActionItem[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

/**
 * Mengambil semua instruksi & kendala untuk satu proyek.
 */
export async function fetchProjectActionItems(
	projectId: number,
	filters: { kategori?: string; status?: string; onlyActive?: boolean } = {}
): Promise<ProjectActionItem[]> {
	if (!projectId) return [];
	try {
		const filterObj: Record<string, any> = {
			project_id: { _eq: projectId }
		};

		if (filters.kategori && filters.kategori !== 'all') {
			filterObj.kategori = { _eq: filters.kategori };
		}
		if (filters.status && filters.status !== 'all') {
			filterObj.status = { _eq: filters.status };
		}
		if (filters.onlyActive) {
			filterObj.status = { _nin: ['closed', 'cancelled'] };
		}

		const result = await directus.request(
			readItems(COLLECTION_ITEMS as any, {
				filter: filterObj as any,
				fields: ITEM_FIELDS as any,
				sort: ['-date_created'] as any,
				limit: 100
			})
		);
		return (result || []) as ProjectActionItem[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

/**
 * Lapor Kendala Urgent dari lapangan (SOS / Hambatan Pekerjaan).
 */
export async function reportFieldIssue(
	projectId: number,
	data: {
		judul: string;
		deskripsi: string;
		dampak: ProjectActionItem['dampak'];
		tingkat_urgensi: ProjectActionItem['tingkat_urgensi'];
		pembuat_id: string;
		pembuat_nama: string;
		photoFiles?: File[];
	}
): Promise<ProjectActionItem> {
	// 1. Upload & kompresi foto kendala
	const uploadedIds: string[] = [];
	if (data.photoFiles && data.photoFiles.length > 0) {
		for (let i = 0; i < data.photoFiles.length; i++) {
			const raw = data.photoFiles[i];
			const compressed = await compressFieldPhoto(raw);
			const fileId = await uploadActionPhoto(compressed, `kendala_${projectId}_${Date.now()}_${i}.jpg`);
			if (fileId) uploadedIds.push(fileId);
		}
	}

	// 2. Nomor Dokumen
	const d = new Date();
	const prefix = `KD-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-`;
	const fallbackDocNo = `${prefix}${String(Date.now()).slice(-4)}`;

	// 3. Simpan item
	const payload = {
		project_id: projectId,
		nomor_dokumen: fallbackDocNo,
		kategori: 'kendala_lapangan',
		tingkat_urgensi: data.tingkat_urgensi || 'normal',
		dampak: data.dampak || 'tidak_signifikan',
		judul: data.judul,
		deskripsi: data.deskripsi,
		pembuat_id: data.pembuat_id,
		pembuat_nama: data.pembuat_nama,
		status: 'open',
		is_gate_blocker: data.tingkat_urgensi === 'kritis_darurat' || data.dampak === 'pekerjaan_terhenti',
		lampiran_masalah: uploadedIds
	};

	try {
		const created: any = await directus.request(createItem(COLLECTION_ITEMS as any, payload as any));

		// Catat log
		await directus.request(
			createItem(COLLECTION_LOGS as any, {
				action_item_id: created.id,
				user_id: data.pembuat_id,
				user_nama: data.pembuat_nama,
				action_type: 'create',
				status_sebelum: null,
				status_sesudah: 'open',
				catatan: `Kendala dilaporkan dari lapangan. Dampak: ${data.dampak}`
			} as any)
		).catch(() => {});

		// Trigger relay notifikasi n8n
		triggerFieldActionNotification('project_action_created', created, projectId, {
			id: data.pembuat_id,
			nama: data.pembuat_nama
		});

		return created as ProjectActionItem;
	} catch (err) {
		handleDirectusError(err);
		throw err;
	}
}

/**
 * Tandai instruksi sudah diterima / dibaca oleh tim lapangan.
 */
export async function acknowledgeDirective(
	actionId: number,
	actor: { id: string; nama: string },
	itemDetails?: Partial<ProjectActionItem>
): Promise<void> {
	try {
		await directus.request(
			updateItem(COLLECTION_ITEMS as any, actionId, {
				status: 'acknowledged'
			} as any)
		);

		await directus.request(
			createItem(COLLECTION_LOGS as any, {
				action_item_id: actionId,
				user_id: actor.id,
				user_nama: actor.nama,
				action_type: 'status_change',
				status_sebelum: 'open',
				status_sesudah: 'acknowledged',
				catatan: 'Instruksi di-acknowledge oleh personil lapangan (Siap Laksanakan)'
			} as any)
		).catch(() => {});

		// Trigger relay notifikasi n8n bahwa leader siap melaksanakan
		triggerFieldActionNotification(
			'project_action_acknowledged',
			{ id: actionId, ...(itemDetails || {}) },
			itemDetails?.project_id || 0,
			actor
		);
	} catch (err) {
		handleDirectusError(err);
		throw err;
	}
}

/**
 * Kirim bukti penyelesaian tugas/instruksi dari lapangan untuk diverifikasi kantor pusat.
 */
export async function submitResolution(
	actionId: number,
	data: {
		catatan_penyelesaian: string;
		actor: { id: string; nama: string };
		proofPhotos?: File[];
		itemDetails?: Partial<ProjectActionItem>;
	}
): Promise<void> {
	// 1. Upload & kompresi foto hasil kerja
	const uploadedIds: string[] = [];
	if (data.proofPhotos && data.proofPhotos.length > 0) {
		for (let i = 0; i < data.proofPhotos.length; i++) {
			const raw = data.proofPhotos[i];
			const compressed = await compressFieldPhoto(raw);
			const fileId = await uploadActionPhoto(compressed, `bukti_selesai_${actionId}_${Date.now()}_${i}.jpg`);
			if (fileId) uploadedIds.push(fileId);
		}
	}

	try {
		await directus.request(
			updateItem(COLLECTION_ITEMS as any, actionId, {
				status: 'pending_verification',
				catatan_penyelesaian: data.catatan_penyelesaian,
				bukti_penyelesaian: uploadedIds
			} as any)
		);

		await directus.request(
			createItem(COLLECTION_LOGS as any, {
				action_item_id: actionId,
				user_id: data.actor.id,
				user_nama: data.actor.nama,
				action_type: 'status_change',
				status_sebelum: 'in_progress',
				status_sesudah: 'pending_verification',
				catatan: `Laporan pelaksanaan diajukan dari lapangan: ${data.catatan_penyelesaian}`
			} as any)
		).catch(() => {});

		// Trigger relay notifikasi n8n bahwa arahan sudah dilaksanakan
		triggerFieldActionNotification(
			'project_action_resolved',
			{
				id: actionId,
				catatan_penyelesaian: data.catatan_penyelesaian,
				bukti_count: uploadedIds.length,
				...(data.itemDetails || {})
			},
			data.itemDetails?.project_id || 0,
			data.actor
		);
	} catch (err) {
		handleDirectusError(err);
		throw err;
	}
}

/**
 * Helper relay notifikasi ke automasi n8n & server notifikasi
 */
export function triggerFieldActionNotification(
	eventType: string,
	actionItem: any,
	projectId: number,
	actor: { id: string; nama: string }
) {
	try {
		fetch('/api/automation/project-action-notify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				eventType,
				actionItem,
				projectId,
				actor
			})
		}).catch(() => {});
	} catch {}
}
