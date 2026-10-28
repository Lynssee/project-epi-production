import directus, { handleDirectusError } from './directus';
import { secureDirectusJson, secureDirectusFetch } from './secureDirectus';
import { updateItem } from '@directus/sdk';

const DIRECTUS_URL = import.meta.env.VITE_DIRECTUS_API_URL;
const DOC_TAG_PREFIX = 'project_doc:';

function docTag(projectId: string | number) {
	return `${DOC_TAG_PREFIX}${projectId}`;
}

export function getDownloadUrl(fileId: string): string {
	return `${DIRECTUS_URL}/assets/${fileId}?download=1`;
}

export function getPreviewUrl(fileId: string): string {
	return `${DIRECTUS_URL}/assets/${fileId}`;
}

export async function getDokumenByProject(projectId: string | number) {
	try {
		const tag = docTag(projectId);
		const json = await secureDirectusJson(
			`/files?filter[description][_contains]=${encodeURIComponent(tag)}&fields=id,title,type,filesize,filename_download,uploaded_on,description&sort=-uploaded_on&limit=100`
		);
		return { success: true, data: json.data ?? [] };
	} catch (error) {
		console.error('getDokumenByProject error:', error);
		return { success: false, data: [] };
	}
}

export async function uploadDokumen(projectId: string | number, file: File, namaFile?: string) {
	try {
		const { uploadFiles } = await import('@directus/sdk');
		const formData = new FormData();
		formData.append('file', file);
		formData.append('title', namaFile || file.name);
		formData.append('description', docTag(projectId));
		const result = await directus.request(uploadFiles(formData)) as any;
		return { success: true, data: result };
	} catch (error) {
		handleDirectusError(error);
		return { success: false };
	}
}

export async function renameDokumen(fileId: string, newTitle: string) {
	try {
		await directus.request(updateItem('directus_files' as any, fileId, { title: newTitle }));
		return { success: true };
	} catch (error) {
		handleDirectusError(error);
		return { success: false };
	}
}

export async function deleteDokumen(fileId: string) {
	try {
		const res = await secureDirectusFetch(`/files/${fileId}`, { method: 'DELETE' });
		if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
		return { success: true };
	} catch (error) {
		console.error('deleteDokumen error:', error);
		return { success: false };
	}
}

export function formatFileSize(bytes: number): string {
	if (!bytes) return '-';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileTypeIcon(type: string): string {
	if (!type) return '📄';
	if (type.startsWith('image/')) return '🖼️';
	if (type === 'application/pdf') return '📋';
	if (type.includes('spreadsheet') || type.includes('excel') || type.includes('csv')) return '📊';
	if (type.includes('word') || type.includes('document')) return '📝';
	if (type.includes('zip') || type.includes('rar') || type.includes('7z')) return '📦';
	if (type.startsWith('video/')) return '🎬';
	return '📄';
}
