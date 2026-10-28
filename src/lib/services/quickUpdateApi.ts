// src/lib/services/quickUpdateApi.ts
// Unified Communication Hub Fase 5 (Rekomendasi #1+#2 Lapangan) — Quick Update dari
// popup + Foto → narasi otomatis via AI. Collection `project_quick_updates` SENGAJA
// terpisah dari `reports` (laporan harian formal, ratusan field wajib) supaya tidak
// mencemari pipeline laporan resmi dengan baris yang isinya cuma teks singkat.
import directus, { handleDirectusError } from './directus';
import { readItems, createItem, uploadFiles } from '@directus/sdk';
import { auth } from '$lib/firebase';

export interface QuickUpdate {
	id: number;
	project_id: number;
	author_uid: string | null;
	author_name: string | null;
	text: string;
	ai_generated: boolean;
	photo: string | null;
	date_created: string;
}

export async function uploadQuickUpdatePhoto(file: File): Promise<string | null> {
	try {
		const formData = new FormData();
		formData.append('file', file);
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function createQuickUpdate(payload: {
	projectId: number;
	authorUid: string | null;
	authorName: string;
	karyawanId: number | null;
	text: string;
	aiGenerated: boolean;
	photoFileId?: string | null;
}): Promise<boolean> {
	try {
		await directus.request(
			createItem('project_quick_updates', {
				project_id: payload.projectId,
				author_uid: payload.authorUid,
				author_name: payload.authorName,
				karyawan_id: payload.karyawanId,
				text: payload.text,
				ai_generated: payload.aiGenerated,
				photo: payload.photoFileId || null
			})
		);
		return true;
	} catch (error) {
		handleDirectusError(error);
		return false;
	}
}

export async function getRecentQuickUpdates(projectId: number, limit = 10): Promise<QuickUpdate[]> {
	try {
		return (await directus.request(
			readItems('project_quick_updates', {
				filter: { project_id: { _eq: projectId } },
				fields: ['id', 'project_id', 'author_uid', 'author_name', 'text', 'ai_generated', 'photo', 'date_created'],
				sort: ['-date_created'],
				limit
			})
		)) as QuickUpdate[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Minta AI membuat narasi laporan progres dari satu foto (Rekomendasi #2 Lapangan).
 * Reuse endpoint /api/ai-assistant yang sama dipakai AsistenSheet — single-turn,
 * bukan streaming, cukup untuk sekali generate caption (bukan percakapan panjang).
 */
export async function generateCaptionFromPhoto(base64: string, mime: string, fileName: string, projectName: string): Promise<string | null> {
	const user = auth?.currentUser;
	if (!user) return null;
	const token = await user.getIdToken();

	const prompt = `Buatkan narasi progres pekerjaan harian yang profesional dalam Bahasa Indonesia (2-4 kalimat) berdasarkan foto lapangan ini, untuk proyek "${projectName}". Fokus pada apa yang terlihat dikerjakan/tercapai. Jangan mengarang detail teknis yang tidak terlihat di foto.`;

	let continuationToken: string | undefined;
	for (let round = 0; round < 3; round++) {
		const res = await fetch('/api/ai-assistant', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify(
				continuationToken
					? { continuationToken, sessionId: `quick-update-${Date.now()}` }
					: {
							messages: [{ role: 'user', content: prompt }],
							page: '/quick-update',
							params: {},
							sessionId: `quick-update-${Date.now()}`,
							attachments: [{ name: fileName, mime, base64 }]
						}
			)
		});
		const data = await res.json().catch(() => null);
		if (!res.ok || !data) return null;
		if (data.status === 'in_progress') {
			continuationToken = data.continuationToken;
			continue;
		}
		return data.text || null;
	}
	return null;
}
