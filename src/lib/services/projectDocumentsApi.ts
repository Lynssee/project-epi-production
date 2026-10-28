// Pertajam Modul Dokumen Proyek, Fase 3: dokumen proyek terpadu (collection project_documents,
// SAMA dengan yang dipakai ERP admin — lihat erp-epi/src/lib/services/projectApi.js). Ini
// menutup gap unifikasi: sebelumnya field dashboard hanya pakai tag `project_doc:<id>` di
// directus_files (lihat dokumenApi.ts, dipertahankan untuk baca dokumen lama sampai admin
// menjalankan migrasi backfill). Upload baru dari sini ditandai source:'field_upload'.
import { secureDirectusJson, secureDirectusFetch } from './secureDirectus';

const DIRECTUS_URL = import.meta.env.VITE_DIRECTUS_API_URL;

const PROJECT_DOCUMENTS_FIELDS = [
	'id', 'project_id', 'file_id', 'nama_dokumen', 'kategori', 'tipe', 'deskripsi',
	'date_created', 'user_created', 'document_type_id', 'document_phase', 'status',
	'is_sensitive', 'access_level', 'source', 'source_module', 'uploaded_by_name',
	'version', 'parent_document_id', 'nomor_dokumen'
].join(',');

export interface DocumentType {
	id: number;
	nama: string;
	kode: string;
	fase_default: string;
	icon: string | null;
	color: string | null;
	is_sensitive_default: boolean;
	deskripsi: string | null;
}

export interface ProjectDocument {
	id: number;
	project_id: number;
	file_id: string | null;
	nama_dokumen: string;
	kategori: string;
	tipe: string;
	deskripsi: string | null;
	date_created: string;
	document_type_id: number | null;
	document_phase: string | null;
	status: string | null;
	is_sensitive: boolean;
	source: string | null;
	uploaded_by_name: string | null;
	version: number;
	parent_document_id: number | null;
	nomor_dokumen: string | null;
}

export function getFileUrl(fileId: string): string {
	return `${DIRECTUS_URL}/assets/${fileId}`;
}

export function getDownloadUrl(fileId: string): string {
	return `${DIRECTUS_URL}/assets/${fileId}?download=1`;
}

/** Daftar dokumen proyek dari collection terpadu project_documents (BUKAN dokumen lama tag directus_files — lihat dokumenApi.ts untuk itu). */
export async function getProjectDocuments(projectId: string | number) {
	try {
		const json = await secureDirectusJson(
			`/items/project_documents?filter[project_id][_eq]=${projectId}&sort=-date_created&limit=-1&fields=${PROJECT_DOCUMENTS_FIELDS}`
		);
		return { success: true, data: (json.data ?? []) as ProjectDocument[] };
	} catch (error) {
		console.error('getProjectDocuments error:', error);
		return { success: false, data: [] as ProjectDocument[] };
	}
}

/** Versi ringan getProjectDocuments — cuma document_type_id+status, dipakai Notification Badge yang harus dicek di setiap halaman proyek tanpa buka tab Dokumen (hemat payload). */
export async function getProjectDocumentTypeStatuses(projectId: string | number) {
	try {
		const json = await secureDirectusJson(
			`/items/project_documents?filter[project_id][_eq]=${projectId}&filter[tipe][_eq]=dokumen&fields=document_type_id,status&limit=-1`
		);
		return { success: true, data: (json.data ?? []) as { document_type_id: number | null; status: string | null }[] };
	} catch (error) {
		console.error('getProjectDocumentTypeStatuses error:', error);
		return { success: false, data: [] as { document_type_id: number | null; status: string | null }[] };
	}
}

/** Jenis dokumen (configurable via admin) — dipisah dari getProjectDocuments (Aturan Anti-Kesalahan #2). */
export async function getDocumentTypes() {
	try {
		const json = await secureDirectusJson(
			`/items/document_types?filter[is_active][_eq]=true&sort=urutan&limit=-1&fields=id,nama,kode,fase_default,icon,color,is_sensitive_default,deskripsi`
		);
		return { success: true, data: (json.data ?? []) as DocumentType[] };
	} catch (error) {
		console.error('getDocumentTypes error:', error);
		return { success: false, data: [] as DocumentType[] };
	}
}

export interface ChecklistTemplateItem {
	id: number;
	document_type_id: number;
	is_required: boolean;
	urutan: number;
}

export interface ChecklistTemplate {
	id: number;
	nama: string;
	is_default: boolean;
	is_active: boolean;
	items: ChecklistTemplateItem[];
}

/** Read-only — dipakai untuk Notification Badge dokumen yang perlu dilengkapi. CRUD template ada di admin (erp-epi). */
export async function getChecklistTemplates() {
	try {
		const json = await secureDirectusJson(
			`/items/document_checklist_template?filter[is_active][_eq]=true&fields=id,nama,is_default,is_active,items.id,items.document_type_id,items.is_required,items.urutan&limit=-1`
		);
		return { success: true, data: (json.data ?? []) as ChecklistTemplate[] };
	} catch (error) {
		console.error('getChecklistTemplates error:', error);
		return { success: false, data: [] as ChecklistTemplate[] };
	}
}

export async function getProjectChecklistOverride(projectId: string | number) {
	try {
		const json = await secureDirectusJson(`/items/projects/${projectId}?fields=document_checklist_template_id`);
		return { success: true, data: (json.data?.document_checklist_template_id ?? null) as number | null };
	} catch (error) {
		console.error('getProjectChecklistOverride error:', error);
		return { success: false, data: null };
	}
}

export async function uploadProjectDocument(
	projectId: string | number,
	file: File,
	opts: {
		documentTypeId?: number | null;
		documentPhase?: string | null;
		kategori?: string;
		isSensitive?: boolean;
		uploadedByName?: string | null;
		namaDokumen?: string;
		deskripsi?: string;
	} = {}
) {
	try {
		const formData = new FormData();
		formData.append('file', file);
		const uploadRes = await secureDirectusFetch('/files', { method: 'POST', body: formData });
		if (!uploadRes.ok) throw new Error('Gagal mengunggah file');
		const uploadJson = await uploadRes.json();
		const fileId = uploadJson.data?.id;
		if (!fileId) throw new Error('File ID tidak ditemukan setelah upload');

		const body = {
			project_id: projectId,
			file_id: fileId,
			nama_dokumen: opts.namaDokumen || file.name,
			deskripsi: opts.deskripsi || null,
			kategori: opts.kategori || 'Lainnya',
			tipe: 'dokumen',
			document_type_id: opts.documentTypeId || null,
			document_phase: opts.documentPhase || null,
			is_sensitive: opts.isSensitive || false,
			source: 'field_upload',
			source_module: 'general',
			// 'final' (nilai lama, sebelum status jadi 5-state workflow di Fase 4) — sekarang
			// 'draft' = "Sudah Upload", ditandai 'review' via updateProjectDocumentStatus bila
			// lapangan mau minta ditinjau admin (lihat Simple Status Update di tab Dokumen).
			status: 'draft',
			uploaded_by_name: opts.uploadedByName || null
		};
		const docRes = await secureDirectusFetch('/items/project_documents', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!docRes.ok) {
			const errJson = await docRes.json().catch(() => ({}));
			throw new Error(errJson.errors?.[0]?.message || 'Gagal menyimpan record dokumen');
		}
		return { success: true, data: (await docRes.json()).data, isNetworkError: false };
	} catch (error) {
		console.error('uploadProjectDocument error:', error);
		// TypeError = fetch gagal terhubung (offline/sinyal lemah), BEDA dari error validasi
		// server — caller (Offline Upload Queue) pakai flag ini untuk tahu kapan harus antre
		// lokal, bukan cuma tampilkan error ke user.
		return { success: false, error: (error as Error).message, isNetworkError: error instanceof TypeError };
	}
}

/**
 * Simple Status Update — lapangan cuma boleh geser antara 'draft' ("Sudah Upload") dan
 * 'review' ("Butuh Review"), TANPA workflow approval penuh (approve/reject/superseded
 * tetap khusus admin di erp-epi). Dibatasi di sini, bukan cuma di UI, supaya endpoint ini
 * tidak bisa disalahgunakan untuk lompat status yang bukan haknya lapangan.
 */
export async function updateProjectDocumentSimpleStatus(docId: number, status: 'draft' | 'review') {
	try {
		const res = await secureDirectusFetch(`/items/project_documents/${docId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status })
		});
		if (!res.ok) throw new Error('Gagal mengubah status dokumen');
		return { success: true };
	} catch (error) {
		console.error('updateProjectDocumentSimpleStatus error:', error);
		return { success: false };
	}
}

export async function deleteProjectDocument(docId: number) {
	try {
		const res = await secureDirectusFetch(`/items/project_documents/${docId}`, { method: 'DELETE' });
		if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
		return { success: true };
	} catch (error) {
		console.error('deleteProjectDocument error:', error);
		return { success: false };
	}
}

// ==================== TRANSMITTAL LOG ====================
// Fase 5 (lanjutan) — catat pengiriman dokumen fisik/salinan ke klien/konsultan. Collection
// SAMA dengan erp-epi (document_transmittals) supaya log terlihat dari kedua dashboard.

export interface Transmittal {
	id: number;
	project_id: number;
	project_document_id: number | null;
	nomor_transmittal: string | null;
	nama_dokumen_manual: string | null;
	tujuan: string;
	pic_penerima: string | null;
	tanggal_kirim: string;
	metode: string;
	status: string;
	tanggal_terima: string | null;
	catatan: string | null;
	foto_bukti: string | null;
	dikirim_oleh: string | null;
	date_created: string;
}

const TRANSMITTAL_FIELDS = ['id', 'project_id', 'project_document_id', 'nomor_transmittal', 'nama_dokumen_manual', 'tujuan', 'pic_penerima', 'tanggal_kirim', 'metode', 'status', 'tanggal_terima', 'catatan', 'foto_bukti', 'dikirim_oleh', 'date_created'].join(',');

export async function getTransmittals(projectId: string | number) {
	try {
		const json = await secureDirectusJson(`/items/document_transmittals?filter[project_id][_eq]=${projectId}&sort=-tanggal_kirim&limit=-1&fields=${TRANSMITTAL_FIELDS}`);
		return { success: true, data: (json.data ?? []) as Transmittal[] };
	} catch (error) {
		console.error('getTransmittals error:', error);
		return { success: false, data: [] as Transmittal[] };
	}
}

export async function createTransmittal(
	projectId: string | number,
	payload: { project_document_id?: number | null; nama_dokumen_manual?: string; tujuan: string; pic_penerima?: string; tanggal_kirim: string; metode?: string; catatan?: string; dikirim_oleh?: string; fotoBuktiFile?: File | null }
) {
	try {
		let fotoBuktiId: string | null = null;
		if (payload.fotoBuktiFile) {
			const formData = new FormData();
			formData.append('file', payload.fotoBuktiFile);
			const uploadRes = await secureDirectusFetch('/files', { method: 'POST', body: formData });
			if (uploadRes.ok) fotoBuktiId = (await uploadRes.json()).data?.id ?? null;
		}
		const res = await secureDirectusFetch('/items/document_transmittals', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				project_id: projectId,
				project_document_id: payload.project_document_id || null,
				nama_dokumen_manual: payload.nama_dokumen_manual || null,
				tujuan: payload.tujuan,
				pic_penerima: payload.pic_penerima || null,
				tanggal_kirim: payload.tanggal_kirim,
				metode: payload.metode || 'langsung',
				status: 'terkirim',
				catatan: payload.catatan || null,
				dikirim_oleh: payload.dikirim_oleh || null,
				foto_bukti: fotoBuktiId
			})
		});
		if (!res.ok) throw new Error('Gagal menyimpan transmittal');
		return { success: true, data: (await res.json()).data };
	} catch (error) {
		console.error('createTransmittal error:', error);
		return { success: false, error: (error as Error).message };
	}
}

export async function updateTransmittal(id: number, payload: Record<string, unknown>) {
	try {
		const res = await secureDirectusFetch(`/items/document_transmittals/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (!res.ok) throw new Error('Gagal mengubah transmittal');
		return { success: true, data: (await res.json()).data };
	} catch (error) {
		console.error('updateTransmittal error:', error);
		return { success: false };
	}
}
